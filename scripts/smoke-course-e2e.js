/**
 * Smoke E2E: crear curso → subir documento → vectorizar → eliminar → verificar S3 y Pinecone.
 *
 * Requisitos (.env):
 *   JWT_SECRET, AWS_*, S3_BUCKET, S3_BUCKET_MODULES
 *   PINECONE_API_KEY, OPENAI_API_KEY (para vectorizar)
 *   E2E_INSTRUCTOR_ID, E2E_INSTRUCTOR_EMAIL (usuario instructor real en DynamoDB)
 *
 * Uso:
 *   # Ver plan sin cambios
 *   node scripts/smoke-course-e2e.js
 *
 *   # Ejecutar flujo completo (crea y borra curso de prueba)
 *   E2E_SMOKE_ALLOW_SYNC=true node scripts/smoke-course-e2e.js --confirm
 *
 *   # API remota
 *   node scripts/smoke-course-e2e.js --api-url https://tututor.co/api --confirm
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  /* dotenv opcional */
}

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { Pinecone } = require('@pinecone-database/pinecone');

function parseArgs(argv) {
  const args = {
    apiUrl: process.env.E2E_API_URL || 'http://localhost:3000',
    userId: process.env.E2E_INSTRUCTOR_ID || null,
    email: process.env.E2E_INSTRUCTOR_EMAIL || 'instructor@e2e.test',
    confirm: false,
    keep: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--api-url') args.apiUrl = argv[++i];
    else if (a === '--user-id') args.userId = argv[++i];
    else if (a === '--email') args.email = argv[++i];
    else if (a === '--confirm') args.confirm = true;
    else if (a === '--keep') args.keep = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Smoke E2E — curso, S3, Pinecone y borrado completo

  node scripts/smoke-course-e2e.js                    # dry-run
  E2E_SMOKE_ALLOW_SYNC=true node scripts/smoke-course-e2e.js --confirm

Variables:
  E2E_INSTRUCTOR_ID     UUID del instructor (obligatorio para --confirm)
  E2E_INSTRUCTOR_EMAIL  email del JWT (default: instructor@e2e.test)
  E2E_API_URL           base URL API (default: http://localhost:3000)
  E2E_SMOKE_ALLOW_SYNC  'true' para vectorización síncrona en el smoke

Opciones:
  --keep    No eliminar el curso al final (depuración)
  --confirm Ejecutar (sin esto solo muestra el plan)
`);
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwt(payload, secret) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${header}.${body}.${sig}`;
}

function authHeaders(userId, email) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado');
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(
    { sub: userId, email, role: 'instructor', iat: now, exp: now + 3600 },
    secret,
  );
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function apiFetch(baseUrl, method, path, headers, body) {
  const url = `${baseUrl.replace(/\/$/, '')}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function s3Client() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error('AWS_REGION requerido');
  return new S3Client({ region });
}

async function listS3Keys(bucket, prefix) {
  const client = s3Client();
  const keys = [];
  let token;
  do {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: 500,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents || []) {
      if (obj.Key && !obj.Key.endsWith('/')) keys.push(obj.Key);
    }
    token = res.NextContinuationToken;
  } while (token);
  return keys;
}

async function pineconeVectorCount(courseId) {
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return 0;
  const indexName = process.env.PINECONE_INDEX || 'courses';
  const pc = new Pinecone({ apiKey });
  const stats = await pc.index(indexName).describeIndexStats();
  const ns = stats.namespaces?.[courseId];
  return ns?.recordCount ?? 0;
}

async function uploadTestFile(baseUrl, headers, courseId, moduleId) {
  const filename = `e2e-smoke-${Date.now()}.txt`;
  const content = `Documento E2E generado ${new Date().toISOString()}\nContenido de prueba para vectorización.`;
  const contentType = 'text/plain';

  const presigned = await apiFetch(baseUrl, 'POST', '/uploads/module/presigned-url', headers, {
    courseId,
    moduleId,
    filename,
    contentType,
  });

  const putRes = await fetch(presigned.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: content,
  });
  if (!putRes.ok) {
    throw new Error(`PUT S3 falló: ${putRes.status}`);
  }
  return presigned.fileKey;
}

async function runSmoke(args) {
  const baseUrl = args.apiUrl;
  const userId = args.userId;

  console.log('\n🧪 Smoke E2E — curso + S3 + Pinecone + delete\n');
  console.log(`  API:        ${baseUrl}`);
  console.log(`  Instructor: ${userId || '(no definido — usa E2E_INSTRUCTOR_ID)'}`);
  console.log(`  Modo:       ${args.confirm ? 'EJECUTAR' : 'dry-run (añade --confirm)'}\n`);

  if (!args.confirm) {
    console.log('Pasos que se ejecutarían:');
    console.log('  1. POST /courses — curso de prueba');
    console.log('  2. POST /courses/:id/modules — módulo con documento');
    console.log('  3. Subir .txt a S3 (presigned URL)');
    console.log('  4. POST trigger-vectorization (sync si E2E_SMOKE_ALLOW_SYNC=true)');
    console.log('  5. Verificar objetos en S3 y vectores en Pinecone');
    if (!args.keep) {
      console.log('  6. DELETE /courses/:id');
      console.log('  7. Verificar S3 vacío y Pinecone namespace eliminado');
    }
    console.log('\nEjemplo: E2E_SMOKE_ALLOW_SYNC=true node scripts/smoke-course-e2e.js --confirm\n');
    return;
  }

  if (!userId) {
    console.error('❌ Define E2E_INSTRUCTOR_ID o --user-id con un instructor válido.');
    process.exit(1);
  }

  const headers = authHeaders(userId, args.email);
  const modulesBucket = process.env.S3_BUCKET_MODULES;
  const courseBucket = process.env.S3_BUCKET;
  if (!modulesBucket || !courseBucket) {
    throw new Error('S3_BUCKET y S3_BUCKET_MODULES requeridos');
  }

  let courseId;
  let moduleId;

  try {
    // 1. Crear curso
    console.log('1/7 Creando curso de prueba…');
    const course = await apiFetch(baseUrl, 'POST', '/courses', headers, {
      title: `E2E Smoke ${new Date().toISOString().slice(0, 19)}`,
      description: 'Curso temporal creado por smoke-course-e2e.js para validar S3 y Pinecone.',
      category: 'other',
      imageUrl: 'https://via.placeholder.com/400x300.png',
      objectives: 'Validar pipeline de creación, vectorización y borrado automático.',
      prerequisites: 'Entorno de desarrollo con credenciales AWS/OpenAI/Pinecone.',
      status: 'draft',
      visibility: 'private',
    });
    courseId = course.id;
    console.log(`   ✓ Curso ${courseId}`);

    // 2. Crear módulo
    console.log('2/7 Creando módulo…');
    const mod = await apiFetch(baseUrl, 'POST', `/courses/${courseId}/modules`, headers, {
      title: 'Módulo E2E',
      description: 'Módulo de prueba con documento para vectorización.',
      order: 1,
      content: 'https://example.com/e2e',
      status: 'published',
    });
    moduleId = mod.id;
    console.log(`   ✓ Módulo ${moduleId}`);

    // 3. Subir archivo
    console.log('3/7 Subiendo documento a S3…');
    const fileKey = await uploadTestFile(baseUrl, headers, courseId, moduleId);
    console.log(`   ✓ ${fileKey}`);

    // 4. Vectorizar
    console.log('4/7 Disparando vectorización…');
    const sync = process.env.E2E_SMOKE_ALLOW_SYNC === 'true';
    const vecBody = { courseId, moduleId, ...(sync ? { sync: true } : {}) };
    const vecResult = await apiFetch(
      baseUrl,
      'POST',
      '/uploads/module/trigger-vectorization',
      headers,
      vecBody,
    );
    if (sync && vecResult.chunks != null) {
      console.log(`   ✓ ${vecResult.chunks} fragmentos, ${vecResult.files} archivos`);
      if (!vecResult.success || vecResult.chunks === 0) {
        throw new Error('Vectorización síncrona no generó fragmentos');
      }
    } else {
      console.log('   ⏳ Vectorización async — esperando Pinecone…');
      let count = 0;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        count = await pineconeVectorCount(courseId);
        if (count > 0) break;
      }
      if (count === 0) {
        throw new Error(
          'Timeout: no aparecieron vectores en Pinecone (activa E2E_SMOKE_ALLOW_SYNC=true en el backend)',
        );
      }
      console.log(`   ✓ ${count} vectores en namespace`);
    }

    // 5. Verificar S3
    console.log('5/7 Verificando S3…');
    const moduleKeys = await listS3Keys(modulesBucket, `courses/${courseId}/`);
    if (moduleKeys.length === 0) {
      throw new Error('No hay objetos en S3 bajo el prefijo del curso');
    }
    console.log(`   ✓ ${moduleKeys.length} objeto(s) en bucket módulos`);

    const vectorsBefore = await pineconeVectorCount(courseId);
    if (vectorsBefore === 0) {
      throw new Error('Pinecone no tiene vectores antes del delete');
    }
    console.log(`   ✓ ${vectorsBefore} vectores en Pinecone`);

    if (args.keep) {
      console.log('\n⚠️  --keep: curso NO eliminado. Borra manualmente:', courseId);
      return;
    }

    // 6. Eliminar curso
    console.log('6/7 Eliminando curso…');
    const del = await apiFetch(baseUrl, 'DELETE', `/courses/${courseId}`, headers);
    console.log(`   ✓ ${del.message || 'Curso eliminado'}`);
    if (del.pineconeNamespaceDeleted === false) {
      console.warn('   ⚠️  Pinecone namespace no confirmado en respuesta');
    }

    // 7. Verificar limpieza
    console.log('7/7 Verificando limpieza…');
    const remainingModule = await listS3Keys(modulesBucket, `courses/${courseId}/`);
    const remainingCourse = await listS3Keys(courseBucket, `courses/${courseId}/`);
    const remainingVectors = await pineconeVectorCount(courseId);

    if (remainingModule.length > 0 || remainingCourse.length > 0) {
      throw new Error(
        `S3 no vacío: modules=${remainingModule.length}, course=${remainingCourse.length}`,
      );
    }
    if (remainingVectors > 0) {
      throw new Error(`Pinecone aún tiene ${remainingVectors} vectores en namespace ${courseId}`);
    }

    console.log('\n✅ Smoke E2E completado: crear → vectorizar → eliminar → S3 y Pinecone limpios\n');
  } catch (err) {
    console.error('\n❌ Smoke E2E falló:', err.message);
    if (courseId && !args.keep) {
      console.error(`   Intenta borrar manualmente: DELETE /courses/${courseId}`);
    }
    process.exit(1);
  }
}

const args = parseArgs(process.argv);
if (args.help) {
  printHelp();
  process.exit(0);
}
runSmoke(args).catch((err) => {
  console.error(err);
  process.exit(1);
});
