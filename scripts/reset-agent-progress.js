/**
 * Reinicia progreso del agente / curso y opcionalmente borra bancos de preguntas.
 *
 * Uso (lee .env del proyecto):
 *
 *   # Ver qué se borraría (sin cambios)
 *   node scripts/reset-agent-progress.js --course-id <UUID>
 *
 *   # Reiniciar progreso de todos los estudiantes en un curso
 *   node scripts/reset-agent-progress.js --course-id <UUID> --confirm
 *
 *   # Además regenerar preguntas (borra banco del curso o de un módulo)
 *   node scripts/reset-agent-progress.js --course-id <UUID> --clear-questions --confirm
 *   node scripts/reset-agent-progress.js --course-id <UUID> --module-id <UUID> --clear-questions --confirm
 *
 *   # Reiniciar TODO el progreso del agente (todos los cursos)
 *   node scripts/reset-agent-progress.js --all --confirm
 *
 * Tablas afectadas:
 *   - ModuleProgress   (módulos completados)
 *   - Progress         (índice de pregunta por teléfono+módulo)
 *   - AgentState       (estado conversacional del agente)
 *   - CourseModuleQuestions (si --clear-questions)
 */

const path = require('path');
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch {
  // dotenv opcional
}

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  ScanCommand,
  BatchWriteCommand,
  QueryCommand,
  GetCommand,
} = require('@aws-sdk/lib-dynamodb');

const prefix = process.env.DYNAMODB_TABLE_PREFIX || '';
const t = (name) => (prefix ? `${prefix}${name}` : name);

const TABLES = {
  moduleProgress: t('ModuleProgress'),
  progress: t('Progress'),
  agentState: t('AgentState'),
  questions: t('CourseModuleQuestions'),
  courseModules: t('CourseModules'),
};

function parseArgs(argv) {
  const args = {
    courseId: null,
    moduleId: null,
    all: false,
    clearQuestions: false,
    confirm: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--course-id') args.courseId = argv[++i];
    else if (a === '--module-id') args.moduleId = argv[++i];
    else if (a === '--all') args.all = true;
    else if (a === '--clear-questions') args.clearQuestions = true;
    else if (a === '--confirm') args.confirm = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Argumento desconocido: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Reinicio de progreso del agente Nedi (DynamoDB)

  node scripts/reset-agent-progress.js --course-id <UUID>              # dry-run
  node scripts/reset-agent-progress.js --course-id <UUID> --confirm    # ejecutar
  node scripts/reset-agent-progress.js --course-id <UUID> --module-id <UUID> --clear-questions --confirm
  node scripts/reset-agent-progress.js --all --confirm

Opciones:
  --course-id <UUID>     Curso a reiniciar (obligatorio salvo --all)
  --module-id <UUID>     Solo un módulo (preguntas/progreso de ese módulo)
  --clear-questions      Borra bancos de preguntas para regenerarlos
  --all                  Todos los cursos / tablas de progreso globales
  --confirm              Aplica cambios (sin esto solo muestra conteos)
`);
}

function createClient() {
  const region = process.env.AWS_REGION;
  if (!region) throw new Error('Falta AWS_REGION en .env');
  const client = new DynamoDBClient({
    region,
    credentials:
      process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
  return DynamoDBDocumentClient.from(client);
}

async function scanTable(doc, tableName, filterExpression, values) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const params = { TableName: tableName, ExclusiveStartKey };
    if (filterExpression) {
      params.FilterExpression = filterExpression;
      params.ExpressionAttributeValues = values;
    }
    const res = await doc.send(new ScanCommand(params));
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function queryModulesByCourse(doc, courseId) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await doc.send(
      new QueryCommand({
        TableName: TABLES.courseModules,
        IndexName: 'courseId-order-index',
        KeyConditionExpression: 'courseId = :courseId',
        ExpressionAttributeValues: { ':courseId': courseId },
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items || []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function batchDelete(doc, tableName, keys) {
  if (!keys.length) return 0;
  let deleted = 0;
  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);
    await doc.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((Key) => ({ DeleteRequest: { Key } })),
        },
      }),
    );
    deleted += batch.length;
  }
  return deleted;
}

async function collectModuleProgress(doc, courseId, moduleId) {
  if (moduleId) {
    return scanTable(doc, TABLES.moduleProgress, 'moduleId = :m', { ':m': moduleId });
  }
  if (courseId) {
    return scanTable(doc, TABLES.moduleProgress, 'courseId = :c', { ':c': courseId });
  }
  return scanTable(doc, TABLES.moduleProgress);
}

async function collectProgress(doc, courseId, moduleId, moduleIds) {
  if (moduleId) {
    return scanTable(doc, TABLES.progress, 'moduleId = :m', { ':m': moduleId });
  }
  if (courseId && moduleIds.length) {
    const all = await scanTable(doc, TABLES.progress);
    const idSet = new Set(moduleIds);
    return all.filter((item) => idSet.has(item.moduleId));
  }
  if (courseId) {
    const byCourse = await scanTable(doc, TABLES.progress, 'courseId = :c', { ':c': courseId });
    if (byCourse.length) return byCourse;
    return [];
  }
  return scanTable(doc, TABLES.progress);
}

async function collectAgentState(doc, courseId) {
  if (courseId) {
    return scanTable(doc, TABLES.agentState, 'courseId = :c', { ':c': courseId });
  }
  return scanTable(doc, TABLES.agentState);
}

async function collectQuestionBanks(doc, courseId, moduleId) {
  const banks = [];
  if (moduleId && courseId) {
    try {
      const res = await doc.send(
        new GetCommand({
          TableName: TABLES.questions,
          Key: { courseId, moduleId },
        }),
      );
      if (res.Item) banks.push({ table: TABLES.questions, key: { courseId, moduleId } });
    } catch {
      /* tabla puede no existir */
    }
    return banks;
  }
  if (courseId) {
    const allQ = await scanTable(doc, TABLES.questions, 'courseId = :c', { ':c': courseId });
    return allQ.map((item) => ({
      table: TABLES.questions,
      key: { courseId: item.courseId, moduleId: item.moduleId },
    }));
  }
  return [];
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.all && !args.courseId) {
    console.error('Indica --course-id <UUID> o --all');
    printHelp();
    process.exit(1);
  }
  if (args.all && args.courseId) {
    console.error('Usa --all o --course-id, no ambos.');
    process.exit(1);
  }

  const doc = createClient();
  const scope = args.all ? 'TODOS los cursos' : `curso ${args.courseId}`;
  const moduleLabel = args.moduleId ? `, módulo ${args.moduleId}` : '';

  console.log(`\nÁmbito: ${scope}${moduleLabel}`);
  console.log(`Prefijo tablas: "${prefix || '(ninguno)'}"\n`);

  let moduleIds = [];
  if (args.courseId && !args.moduleId) {
    const modules = await queryModulesByCourse(doc, args.courseId);
    moduleIds = modules.map((m) => m.id);
    console.log(`Módulos del curso: ${moduleIds.length}`);
  } else if (args.moduleId) {
    moduleIds = [args.moduleId];
  }

  const [moduleProgress, progress, agentState, questionBanks] = await Promise.all([
    collectModuleProgress(doc, args.all ? null : args.courseId, args.moduleId),
    collectProgress(
      doc,
      args.all ? null : args.courseId,
      args.moduleId,
      moduleIds,
    ),
    collectAgentState(doc, args.all ? null : args.courseId),
    args.clearQuestions
      ? collectQuestionBanks(doc, args.courseId, args.moduleId)
      : Promise.resolve([]),
  ]);

  console.log('Registros a eliminar:');
  console.log(`  ModuleProgress (módulos completados): ${moduleProgress.length}`);
  console.log(`  Progress (avance por pregunta):       ${progress.length}`);
  console.log(`  AgentState (estado conversacional):   ${agentState.length}`);
  if (args.clearQuestions) {
    console.log(`  Bancos de preguntas:                  ${questionBanks.length}`);
  }

  if (!args.confirm) {
    console.log('\nDry-run: no se borró nada. Añade --confirm para ejecutar.\n');
    return;
  }

  console.log('\nEliminando...');

  const d1 = await batchDelete(
    doc,
    TABLES.moduleProgress,
    moduleProgress.map((r) => ({ id: r.id })),
  );
  const d2 = await batchDelete(
    doc,
    TABLES.progress,
    progress.map((r) => ({ phoneNumber: r.phoneNumber, moduleId: r.moduleId })),
  );
  const d3 = await batchDelete(
    doc,
    TABLES.agentState,
    agentState.map((r) => ({ id: r.id })),
  );

  let d4 = 0;
  if (args.clearQuestions && questionBanks.length) {
    const byTable = {};
    for (const b of questionBanks) {
      if (!byTable[b.table]) byTable[b.table] = [];
      byTable[b.table].push(b.key);
    }
    for (const [table, keys] of Object.entries(byTable)) {
      d4 += await batchDelete(doc, table, keys);
    }
  }

  console.log('\nListo:');
  console.log(`  ModuleProgress: ${d1}`);
  console.log(`  Progress:       ${d2}`);
  console.log(`  AgentState:     ${d3}`);
  if (args.clearQuestions) console.log(`  Preguntas:      ${d4}`);
  console.log('\nLos estudiantes pueden volver a empezar el curso desde el módulo 1.');
  if (args.clearQuestions) {
    console.log('Los bancos de preguntas se regenerarán en la próxima sesión de preguntas.\n');
  } else {
    console.log('Las preguntas existentes se conservaron (usa --clear-questions para borrarlas).\n');
  }
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
