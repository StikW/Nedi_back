# Tablas DynamoDB

Inventario alineado con el script `scripts/create-dynamodb-tables.js` y el uso real en NestJS / n8n.

## Qué usa cada capa

| Tabla | NestJS (código) | n8n / workers | Script de creación |
|-------|-----------------|---------------|-------------------|
| Users | Sí | — | Sí |
| Courses | Sí | — | Sí |
| CourseModules | Sí | — | Sí |
| Students | Sí | — | Sí |
| ModuleProgress | Sí | Opcional | Sí |
| Workflows | Sí | — | Sí |
| Credentials | Sí | — | Sí |
| TokenBlacklist | Sí | — | Sí |
| CourseModuleProgress | No | Sí (banco de preguntas) | Sí |
| Progress | No | Sí (avance por alumno) | Sí |
| CourseModuleQuestions | No | Legacy (mismo esquema que arriba) | No |
| ~~CourseGamification~~ | Eliminada | — | No |

**Preguntas por curso/módulo:** deberían vivir solo en **`CourseModuleProgress`** (`courseId` + `moduleId`). Si n8n aún escribe en **`CourseModuleQuestions`**, migra los nodos a un solo nombre y borra la tabla duplicada cuando esté vacía o migrada.

**Avance por estudiante (WhatsApp):** **`Progress`** (`phoneNumber` + `moduleId`). Completados registrados por la API: **`ModuleProgress`** (`id` = `{teléfono}#{moduleId}`).

**JWT en logout:** solo **`TokenBlacklist`** (no crear variantes con otro nombre).

## Esquema (tablas oficiales)

| Tabla | Clave primaria | GSI |
|-------|----------------|-----|
| **Users** | `id` | `email-index` (PK: `email`) |
| **Courses** | `id` | `instructorId-index` |
| **CourseModules** | `id` | `courseId-order-index`, `courseId-status-index` |
| **CourseModuleProgress** | `courseId`, `moduleId` | — |
| **ModuleProgress** | `id` | — |
| **Progress** | `phoneNumber`, `moduleId` | — |
| **Students** | `id` | `courseId-index`, `phoneNumber-index` |
| **Workflows** | `id` | `ownerId-index` |
| **Credentials** | `id` | `instructorId-index` |
| **TokenBlacklist** | `token` | — |
| **MetaContacts** | `id` | — |
| **MetaTemplates** | `id` | — |
| **MetaApiConfig** | `id` (`GLOBAL`) | — |
| **MetaMessages** | `id` | — |
| **MetaWebhookEvents** | `id` | — |
| **MetaApiLogs** | `id` | — |

## Crear tablas

```bash
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
# Opcional: dev_ → dev_Users, dev_Courses, ...
export DYNAMODB_TABLE_PREFIX=

cd backup_back
node scripts/create-dynamodb-tables.js
```

El script omite tablas que ya existen. También puedes crearlas manualmente en la consola AWS siguiendo las claves de la tabla anterior.

## Prefijo de tablas

Con `DYNAMODB_TABLE_PREFIX=dev_` el código usa `dev_Users`, `dev_Courses`, etc. Sin prefijo: `Users`, `Courses`, …
