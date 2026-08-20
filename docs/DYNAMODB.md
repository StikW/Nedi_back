# Tablas DynamoDB

Inventario alineado con el script `scripts/create-dynamodb-tables.js` y el uso real en NestJS.

## Qué usa cada capa

| Tabla | NestJS (código) | Script de creación |
|-------|-----------------|-------------------|
| Users | Sí | Sí |
| Courses | Sí | Sí |
| CourseModules | Sí | Sí |
| Students | Sí | Sí |
| ModuleProgress | Sí | Sí |
| AgentState | Sí (agente) | Sí* |
| TokenBlacklist | Sí | Sí |
| CourseModuleQuestions | Sí (agente) | Sí |
| Progress | Sí (agente) | Sí |
| MetaContacts, MetaTemplates, MetaApiConfig, MetaMessages, MetaWebhookEvents, MetaApiLogs | Sí (recordatorios) | Sí |
| Workflows, Credentials | Legacy (n8n) | Sí |
| ~~CourseGamification~~ | Eliminada | No |

\* Si falta `AgentState`, créala manualmente: PK `id` (String).

**Preguntas por curso/módulo:** banco en **`CourseModuleQuestions`** / **`CourseModuleProgress`** (`courseId` + `moduleId`).

**Avance por pregunta (WhatsApp):** **`Progress`** (`phoneNumber` + `moduleId`).

**Completados vía API:** **`ModuleProgress`** (`id` = `{teléfono}#{moduleId}`).

**Estado del agente:** **`AgentState`** (`id` = `{instance}#{phone}`). Incluye `awaitingActivityConfirmation`, `awaitingModuleStartConfirmation`, `courseId`, `moduleId`, `flujo`, etc.

## Esquema (tablas principales)

| Tabla | Clave primaria | GSI | Atributos relevantes |
|-------|----------------|-----|----------------------|
| **Users** | `id` | `email-index` | `evolutionInstance`, `evolutionApiKey`, `evolutionNumber`, … |
| **Courses** | `id` | `instructorId-index` | `title`, `status`, `instructorId`, … |
| **CourseModules** | `id` | `courseId-order-index`, `courseId-status-index` | `title`, `description`, `order`, `content` (video URL), `activityUrl`, `resources[]`, `status` |
| **CourseModuleQuestions** | `courseId`, `moduleId` | — | Banco de preguntas generadas |
| **Progress** | `phoneNumber`, `moduleId` | — | Avance pregunta a pregunta |
| **ModuleProgress** | `id` | — | Módulo completado |
| **Students** | `id` | `courseId-index`, `phoneNumber-index` | `phoneNumber`, `courseId`, `instructorId`, … |
| **AgentState** | `id` | — | Estado conversacional del agente |
| **TokenBlacklist** | `token` | — | JWT invalidados |
| **Meta\*** | `id` | — | Recordatorios WhatsApp Meta |

`CourseModules` es **schemaless** en atributos opcionales: `activityUrl` se añade sin migración de tabla. Enviar `""` en update elimina `content` o `activityUrl`.

## Crear tablas

```bash
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# Opcional: dev_ → dev_Users, dev_Courses, ...
export DYNAMODB_TABLE_PREFIX=

cd Nedi_back
node scripts/create-dynamodb-tables.js
```

El script omite tablas que ya existen.

## Prefijo de tablas

Con `DYNAMODB_TABLE_PREFIX=dev_` el código usa `dev_Users`, `dev_Courses`, etc. Sin prefijo: `Users`, `Courses`, …
