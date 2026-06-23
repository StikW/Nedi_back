/**
 * Diagnóstico rápido de conectividad con Evolution API.
 * Uso: node scripts/check-evolution.mjs
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '../.env');

function loadEnv() {
  const vars = {};
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  } catch {
    console.error('No se pudo leer .env en', envPath);
    process.exit(1);
  }
  return vars;
}

const env = loadEnv();
const baseUrl = (env.EVOLUTION_SERVER_URL || '').replace(/\/+$/, '');
const apiKey = env.EVOLUTION_ADMIN_API_KEY || '';

if (!baseUrl || !apiKey) {
  console.error('Faltan EVOLUTION_SERVER_URL o EVOLUTION_ADMIN_API_KEY en .env');
  process.exit(1);
}

const timeoutMs = 15_000;

async function probe(label, path) {
  const url = `${baseUrl}${path}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { apikey: apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    let body = '';
    try {
      body = JSON.stringify(await res.json());
    } catch {
      body = '(sin JSON)';
    }
    const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;
    console.log(`${label}: HTTP ${res.status} (${ms}ms) ${preview}`);
    return res.ok;
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`${label}: FALLO (${ms}ms) ${err.message}`);
    return false;
  }
}

console.log(`Evolution URL: ${baseUrl}`);
console.log('---');

const ok = await probe('fetchInstances', '/instance/fetchInstances');
if (!ok) {
  console.log('\n❌ Evolution no es accesible desde esta máquina.');
  console.log('   Si desarrollas en local, abre el puerto 8080 en el security group de AWS');
  console.log('   o usa túnel SSH: ssh -L 8080:127.0.0.1:8080 user@13.59.170.47');
  console.log('   y cambia EVOLUTION_SERVER_URL=http://127.0.0.1:8080');
  process.exit(1);
}

console.log('\n✅ Evolution responde correctamente desde este entorno.');
