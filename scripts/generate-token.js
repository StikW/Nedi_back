/**
 * Genera un JWT con el mismo formato que el backend (para n8n, pruebas, etc.).
 * Uso: node scripts/generate-token.js
 *
 * Necesita el secreto y el payload. Por defecto lee .env y un payload de ejemplo.
 * Puedes pasar argumentos: node scripts/generate-token.js <userId> <email> <role>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signHS256(data, secret) {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateToken(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signHS256(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

// Cargar JWT_SECRET desde .env si existe
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return process.env.JWT_SECRET;
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/JWT_SECRET=(.+)/);
  if (match) return match[1].trim().replace(/^["']|["']$/g, '');
  return process.env.JWT_SECRET;
}

const secret = loadEnv() || process.argv[2];
if (!secret) {
  console.error('Uso: node scripts/generate-token.js');
  console.error('  Asegúrate de tener JWT_SECRET en .env');
  console.error('  O: node scripts/generate-token.js <JWT_SECRET>');
  process.exit(1);
}

// Payload: sub, email, role (igual que el backend)
const userId = process.argv[3] || 'user-id-ejemplo';
const email = process.argv[4] || 'instructor@ejemplo.com';
const role = process.argv[5] || 'instructor';

const now = Math.floor(Date.now() / 1000);
const hundredYears = 100 * 365 * 24 * 3600;
const payload = {
  sub: userId,
  email: email,
  role: role,
  iat: now,
  exp: now + hundredYears, // ~100 años (prácticamente permanente)
};

const token = generateToken(payload, secret);
console.log('Token generado (Bearer):');
console.log(token);
console.log('\nPayload usado:', JSON.stringify(payload, null, 2));
