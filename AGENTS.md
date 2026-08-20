# AGENTS.md — Contexto del proyecto (TuTutor / NEDI)

Backend de la plataforma educativa **NEDI**: los instructores crean cursos/módulos y
los estudiantes aprenden por **microlearning vía WhatsApp** con un agente de IA ("Nedi").

## Stack
- **NestJS 10** (TypeScript, Node 18+).
- **DynamoDB** (`@aws-sdk/lib-dynamodb`) como base de datos principal.
- **S3** para recursos de cursos/módulos.
- **JWT** (`@nestjs/passport` + `JwtAuthGuard`) para auth de la API.
- **OpenAI** (chat, embeddings, transcripción, visión, TTS) — único proveedor LLM.
- **Pinecone** para RAG (índice `courses`, `namespace=courseId`, metadata `module=moduleId`).
- **Evolution API** = WhatsApp del agente (conversacional). **Meta Cloud API** = solo recordatorios.

## Comandos (ejecutar dentro de `Nedi_back/`)
- `npm run build` — compila (nest build).
- `npm run start:dev` — dev con watch.
- `npm run lint` — eslint --fix.
- `node scripts/create-dynamodb-tables.js` — crea las tablas DynamoDB (respeta `DYNAMODB_TABLE_PREFIX`).

## Estructura
- `src/controllers/` — controladores HTTP.
- `src/services/` — lógica de dominio (course, course-module, student, module-progress, uploads, reminders, etc.).
- `src/services/agent/` — el **agente Nedi** (ver abajo).
- `src/models/` — entidades + DTOs. Cada entidad define su `*_TABLE` con prefijo `DYNAMODB_TABLE_PREFIX`.
- `src/modules/` — módulos NestJS; se registran en `src/app.module.ts`.
- `src/core/config/env.config.ts` — todas las variables de entorno (namespace `env`).
- `scripts/` — utilidades (creación de tablas, `reset-agent-progress.js`, `smoke-course-e2e.js`, etc.).
- `docs/` — `API.md`, `DYNAMODB.md`.

## Agente Nedi (`src/services/agent/`)
Migrado desde n8n a código NestJS. Flujo: webhook Evolution → buffer/debounce → media a texto →
clasificar intención → sub-agente → respuesta por Evolution. Multi-instructor (multi-tenant).

| Archivo | Rol |
|---------|-----|
| `agent-orchestrator.service.ts` | Orquesta webhook, tenant, envío |
| `tenant.service.ts` | Resuelve instructor por `instance` + `apikey` |
| `agents.service.ts` | Clasificador + agentes (conversación, preguntas, respuestas, explicar) |
| `llm.service.ts` | Cliente OpenAI con tool-calling |
| `rag.service.ts` / `vectorization.service.ts` | Pinecone (consulta / ingesta PDF de S3) |
| `questions.service.ts` | Banco y avance de preguntas |
| `agent-state.service.ts` | Estado conversacional en DynamoDB |
| `evolution.service.ts` | Envío WhatsApp (texto, audio, media); resolución `@lid` |
| `evolution-admin.service.ts` | Crear instancia Evolution + QR + webhook |

**Endpoints:** `POST /agent/webhook` (público), `POST/GET /agent/evolution/connect|status|logout|health` (JWT instructor), `POST /uploads/module/trigger-vectorization` (JWT).

### Intro del módulo (pregunta 1)

Solo en la **primera pregunta** de cada módulo (`index === 0`). En preguntas 2+ solo se envían preguntas.

Orden cuando el estudiante entra al flujo de preguntas:

1. **Actividad** (`activityUrl`) — si existe, se envía el enlace y se pide confirmación (`sí`/`listo`/…). Se reenvía mientras siga en P1 sin confirmar.
2. **Video** (`content`) — si existe, se envía después de confirmar la actividad (o primero si no hay actividad). Igual con confirmación.
3. **Pregunta 1** — audio resumen + texto de la pregunta.

Si no hay `activityUrl` ni `content`, se pide confirmación y se pasa directo a la pregunta 1.

### Contactos `@lid` (WhatsApp)

WhatsApp a veces envía `remoteJid` como `NNNN@lid` sin teléfono real. El agente:

- Responde al JID completo `@lid` vía Evolution.
- Resuelve el teléfono real buscando `remoteJidAlt` en el historial de Evolution (`findMessages`) para matrículas y progreso en DynamoDB.
- Si Evolution no envía `remoteJidAlt`, conviene actualizar Evolution (`WPP_LID_MODE=false`, versión reciente).

### Probar en local con ngrok

```
Backend local :3000  →  ngrok http 3000
AGENT_WEBHOOK_PUBLIC_URL=https://xxx.ngrok-free.app/agent/webhook   ← sin /api
Reconectar WhatsApp desde el panel instructor
```

Producción: `AGENT_WEBHOOK_PUBLIC_URL=https://tututor.co/api/agent/webhook`

## Módulos de curso (panel instructor)

| Campo API | Campo UI (front) | Uso |
|-----------|------------------|-----|
| `content` | URL del video | Video intro en pregunta 1 |
| `activityUrl` | URL de actividad | Enlace externo (Wordwall, Forms…) en pregunta 1, **antes** del video |
| `resources[]` | PDFs | Material para RAG / generación de preguntas |

Al editar, enviar `content` o `activityUrl` vacío (`""`) **borra** el campo en DynamoDB.

## Datos (DynamoDB)
- Estado conversacional: **`AgentState`** (`id = "${instance}#${phone}"`). Campos: `awaitingActivityConfirmation`, `awaitingModuleStartConfirmation`, `awaitingPostAnswerAction`, …
- Banco de preguntas: **`CourseModuleQuestions`** / **`CourseModuleProgress`** (`courseId` + `moduleId`).
- Avance por pregunta (WhatsApp): **`Progress`** (`phoneNumber` + `moduleId`).
- Módulos completados (API): **`ModuleProgress`**. Catálogo: `Users`, `Courses`, `CourseModules`, `Students`.
- Evolution del instructor: entidad **`User`** (`evolutionInstance`, `evolutionApiKey`, `evolutionNumber`, `evolutionStatus`).

## Convenciones
- Servicios inyectan `@Inject('DYNAMODB_CLIENT')`; reutilizar servicios de dominio existentes.
- Variables de entorno: `ConfigService.get('NOMBRE_CRUDO')` (no anidado).
- Teléfonos normalizados a E.164 sin `+`.
- Tras editar: `npm run build` para verificar tipos.
- Solo OpenAI — no DeepSeek ni otros proveedores.

## Variables de entorno clave del agente

`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_CLASSIFIER_MODEL`, `OPENAI_TRANSCRIBE_MODEL`,
`OPENAI_VISION_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_EMBEDDING_MODEL`, `PINECONE_API_KEY`,
`PINECONE_INDEX=courses`, `EVOLUTION_SERVER_URL`, `EVOLUTION_ADMIN_API_KEY`,
`AGENT_WEBHOOK_PUBLIC_URL`, `AGENT_BUFFER_SECONDS`, `AGENT_SESSION_TIMEOUT_MINUTES` (default 20),
`AGENT_TYPING_DELAY_MS` (default 1200).
