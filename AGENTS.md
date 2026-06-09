# AGENTS.md — Contexto del proyecto (TuTutor / NEDI)

Backend de la plataforma educativa **NEDI**: los instructores crean cursos/módulos y
los estudiantes aprenden por **microlearning vía WhatsApp** con un agente de IA ("Nedi").

## Stack
- **NestJS 10** (TypeScript, Node 22).
- **DynamoDB** (`@aws-sdk/lib-dynamodb`) como base de datos principal.
- **S3** para recursos de cursos/módulos.
- **JWT** (`@nestjs/passport` + `JwtAuthGuard`) para auth de la API.
- **OpenAI** (chat, embeddings, transcripción, visión, TTS) — único proveedor LLM.
- **Pinecone** para RAG (índice `courses`, `namespace=courseId`, metadata `module=moduleId`).
- **Evolution API** = WhatsApp del agente (conversacional). **Meta Cloud API** = solo recordatorios.

## Comandos (ejecutar dentro de `backup_back/`)
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
- `scripts/` — utilidades (creación de tablas).
- `docs/` — `API.md`, `DYNAMODB.md`.

## Agente Nedi (`src/services/agent/`)
Migrado 1:1 desde n8n a código. Flujo: webhook Evolution → buffer/debounce → media a texto →
clasificar intención → sub-agente → respuesta por Evolution. Multi-instructor (multi-tenant).
- `agent-orchestrator.service.ts` — orquesta todo el flujo.
- `tenant.service.ts` — resuelve el instructor por `instance`+`apikey` del payload.
- `agents.service.ts` — clasificador único + agentes (conversación, preguntas, respuestas, explicar).
- `llm.service.ts` — cliente OpenAI con loop de tool-calling (function calling).
- `rag.service.ts` / `vectorization.service.ts` — Pinecone (consulta / ingesta PDF-TXT de S3).
- `questions.service.ts` — banco y avance de preguntas; `agent-state.service.ts` — estado conversacional.
- `evolution.service.ts` (envío/media) y `evolution-admin.service.ts` (crear instancia + QR).
- Endpoints: `POST /agent/webhook` (público), `POST/GET /agent/evolution/connect|status|logout` (JWT instructor),
  `POST /uploads/module/trigger-vectorization` (JWT, en `vectorization.controller.ts`).

## Datos (DynamoDB)
- Estado conversacional del agente: tabla `AgentState` (clave `id = "${instance}#${phone}"`).
- Banco de preguntas: `CourseModuleQuestions` (clave `courseId+moduleId`; fallback lectura `CourseModuleProgress`).
- Avance del estudiante por módulo: `Progress` (clave `wa{phoneNumber}+moduleId`, campo `status`).
- Módulos completados (API): `ModuleProgress`. Otras: `Users`, `Courses`, `CourseModules`, `Students`.
- Config Evolution del instructor vive en la entidad `User` (`evolutionInstance/ApiKey/Number/Status`).

## Convenciones
- Servicios inyectan `@Inject('DYNAMODB_CLIENT')`; reutilizar servicios de dominio existentes en vez de hacer queries nuevas.
- Variables de entorno se leen con `ConfigService.get('NOMBRE_CRUDO')` (no anidado), igual que el resto del código.
- Teléfonos se normalizan a E.164 sin `+`.
- Tras editar, ejecutar `npm run build` para verificar tipos.
- No usar DeepSeek ni otros proveedores: solo OpenAI (`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, etc.).

## Variables de entorno clave del agente
`OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, `OPENAI_CLASSIFIER_MODEL`, `OPENAI_TRANSCRIBE_MODEL`,
`OPENAI_VISION_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_EMBEDDING_MODEL`, `PINECONE_API_KEY`,
`PINECONE_INDEX=courses`, `EVOLUTION_SERVER_URL`, `EVOLUTION_ADMIN_API_KEY`,
`AGENT_WEBHOOK_PUBLIC_URL`, `AGENT_BUFFER_SECONDS`. (Ver defaults en `src/core/config/env.config.ts`.)
Ejemplo producción: `AGENT_WEBHOOK_PUBLIC_URL=https://tututor.co/api/agent/webhook`
