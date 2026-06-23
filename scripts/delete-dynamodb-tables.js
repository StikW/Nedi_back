/**
 * Elimina tablas DynamoDB obsoletas.
 *
 * Uso:
 *   node scripts/delete-dynamodb-tables.js --confirm
 *
 * Sin --confirm solo lista las tablas que se borrarían.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { DynamoDBClient, DeleteTableCommand, DescribeTableCommand } = require('@aws-sdk/client-dynamodb');

const prefix = process.env.DYNAMODB_TABLE_PREFIX || '';

const TABLES_TO_DELETE = [
  'MetaContacts',
  'MetaTemplates',
  'MetaApiConfig',
  'MetaMessages',
  'MetaWebhookEvents',
  'MetaApiLogs',
  'TokenBlacklist',
  'TokenBlackList',
  'Workflows',
  'Credentials',
  'CourseModuleProgress',
].map((name) => (prefix ? `${prefix}${name}` : name));

async function exists(client, name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return false;
    throw e;
  }
}

async function main() {
  const confirm = process.argv.includes('--confirm');
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new DynamoDBClient({ region });

  console.log(`Región: ${region}`);
  console.log(`Prefijo: ${prefix || '(ninguno)'}`);
  console.log('');

  for (const name of TABLES_TO_DELETE) {
    const ok = await exists(client, name);
    if (!ok) {
      console.log(`[SKIP] ${name} — no existe`);
      continue;
    }
    if (!confirm) {
      console.log(`[PENDIENTE] ${name}`);
      continue;
    }
    await client.send(new DeleteTableCommand({ TableName: name }));
    console.log(`[ELIMINADA] ${name}`);
  }

  if (!confirm) {
    console.log('\nDry-run. Ejecuta con --confirm para borrar.');
  } else {
    console.log('\nListo.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
