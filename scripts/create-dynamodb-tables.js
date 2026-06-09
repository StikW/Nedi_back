/**
 * Script para crear todas las tablas DynamoDB del proyecto IA Learning en AWS.
 *
 * Uso (lee `.env` del proyecto si existe):
 *   node scripts/create-dynamodb-tables.js
 *
 * O con variables explícitas:
 *   export AWS_REGION=us-east-2
 *   export AWS_ACCESS_KEY_ID=...
 *   export AWS_SECRET_ACCESS_KEY=...
 *   export DYNAMODB_TABLE_PREFIX=dev_   # opcional; ej. dev_Users
 *   node scripts/create-dynamodb-tables.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} = require('@aws-sdk/client-dynamodb');

const prefix = process.env.DYNAMODB_TABLE_PREFIX || '';

function tableName(name) {
  return prefix ? `${prefix}${name}` : name;
}

const tables = [
  {
    name: tableName('Users'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'email', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('Courses'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'instructorId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'instructorId-index',
        KeySchema: [{ AttributeName: 'instructorId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('CourseModules'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'courseId', AttributeType: 'S' },
      { AttributeName: 'order', AttributeType: 'N' },
      { AttributeName: 'status', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'courseId-order-index',
        KeySchema: [
          { AttributeName: 'courseId', KeyType: 'HASH' },
          { AttributeName: 'order', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'courseId-status-index',
        KeySchema: [
          { AttributeName: 'courseId', KeyType: 'HASH' },
          { AttributeName: 'status', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('CourseModuleQuestions'),
    keySchema: [
      { AttributeName: 'courseId', KeyType: 'HASH' },
      { AttributeName: 'moduleId', KeyType: 'RANGE' },
    ],
    attributeDefinitions: [
      { AttributeName: 'courseId', AttributeType: 'S' },
      { AttributeName: 'moduleId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [],
  },
  {
    name: tableName('CourseModuleProgress'),
    keySchema: [
      { AttributeName: 'courseId', KeyType: 'HASH' },
      { AttributeName: 'moduleId', KeyType: 'RANGE' },
    ],
    attributeDefinitions: [
      { AttributeName: 'courseId', AttributeType: 'S' },
      { AttributeName: 'moduleId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [],
  },
  {
    name: tableName('ModuleProgress'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    globalSecondaryIndexes: [],
  },
  {
    name: tableName('Progress'),
    keySchema: [
      { AttributeName: 'phoneNumber', KeyType: 'HASH' },
      { AttributeName: 'moduleId', KeyType: 'RANGE' },
    ],
    attributeDefinitions: [
      { AttributeName: 'phoneNumber', AttributeType: 'S' },
      { AttributeName: 'moduleId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [],
  },
  {
    name: tableName('Students'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'courseId', AttributeType: 'S' },
      { AttributeName: 'phoneNumber', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'courseId-index',
        KeySchema: [{ AttributeName: 'courseId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'phoneNumber-index',
        KeySchema: [{ AttributeName: 'phoneNumber', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('Workflows'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'ownerId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'ownerId-index',
        KeySchema: [{ AttributeName: 'ownerId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('Credentials'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
      { AttributeName: 'instructorId', AttributeType: 'S' },
    ],
    globalSecondaryIndexes: [
      {
        IndexName: 'instructorId-index',
        KeySchema: [{ AttributeName: 'instructorId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
  {
    name: tableName('TokenBlacklist'),
    keySchema: [{ AttributeName: 'token', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'token', AttributeType: 'S' }],
    globalSecondaryIndexes: [],
  },
  {
    // Estado conversacional del agente Nedi por (instancia + telefono).
    // id compuesto: `${instance}#${phoneNumber}`
    name: tableName('AgentState'),
    keySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
    attributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
    globalSecondaryIndexes: [],
  },
];

async function tableExists(client, name) {
  try {
    await client.send(new DescribeTableCommand({ TableName: name }));
    return true;
  } catch (e) {
    if (e.name === 'ResourceNotFoundException') return false;
    throw e;
  }
}

async function createTable(client, def) {
  const exists = await tableExists(client, def.name);
  if (exists) {
    console.log(`[OK] La tabla ${def.name} ya existe.`);
    return;
  }
  const params = {
    TableName: def.name,
    KeySchema: def.keySchema,
    AttributeDefinitions: def.attributeDefinitions,
    BillingMode: 'PAY_PER_REQUEST',
  };
  if (def.globalSecondaryIndexes && def.globalSecondaryIndexes.length > 0) {
    params.GlobalSecondaryIndexes = def.globalSecondaryIndexes;
  }
  try {
    await client.send(new CreateTableCommand(params));
    console.log(`[CREADA] ${def.name}`);
  } catch (e) {
    if (e instanceof ResourceInUseException) {
      console.log(`[OK] La tabla ${def.name} ya existe (creación en curso).`);
    } else {
      throw e;
    }
  }
}

async function main() {
  const region = process.env.AWS_REGION || 'us-east-1';
  const client = new DynamoDBClient({ region });

  console.log(`Región: ${region}`);
  if (prefix) console.log(`Prefijo de tablas: ${prefix}`);
  console.log('');

  for (const def of tables) {
    await createTable(client, def);
  }

  console.log('\nListo. Todas las tablas están creadas o ya existían.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
