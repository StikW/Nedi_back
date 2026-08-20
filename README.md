# Backend Nedi (NestJS)

API de la plataforma Tututor: cursos, estudiantes, uploads S3, progreso de módulos, agente WhatsApp (Nedi), recordatorios Meta y panel admin.

## Requisitos

- Node.js 18+
- Cuenta AWS (DynamoDB, S3)
- `.env` en la raíz de `Nedi_back/` (no versionar)

## Instalación local

```bash
cd Nedi_back
npm install
# Crea .env con las variables de la sección siguiente
npm run start:dev
```

Servidor: `http://localhost:3000` — health: `GET /health` (sin prefijo `/api` en local; en producción Nginx expone `/api/health`).

## Probar el agente en local (ngrok)

Para probar cambios del agente sin desplegar a EC2:

1. Backend en `npm run start:dev` (puerto 3000).
2. Túnel: `ngrok http 3000`
3. En `.env`:
   ```env
   AGENT_WEBHOOK_PUBLIC_URL=https://TU-SUBDOMINIO.ngrok-free.app/agent/webhook
   ```
   **Sin** `/api` en local (Nginx añade `/api` solo en producción).
4. Reinicia el backend y reconecta WhatsApp desde el panel (`POST /agent/evolution/connect`) o actualiza el webhook en Evolution.
5. Al terminar, restaura `AGENT_WEBHOOK_PUBLIC_URL=https://tututor.co/api/agent/webhook` y vuelve a configurar Evolution.

Ver detalle en [AGENTS.md](AGENTS.md).

## Despliegue en servidor (PM2)

`git pull` **no** regenera `dist/`. Tras cada actualización de código:

```bash
cd Nedi_back
./scripts/deploy-pm2.sh ia-learning-backend
```

El script ejecuta `npm install`, `npm run build` y reinicia PM2. Verifica:

```bash
curl -s http://127.0.0.1:3000/health
curl -s https://tututor.co/api/health
```

## Variables de entorno

| Grupo | Variables |
|-------|-----------|
| AWS | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| S3 | `S3_BUCKET`, `S3_BUCKET_MODULES` |
| JWT | `JWT_SECRET`, `JWT_EXPIRES_IN` |
| DynamoDB | `DYNAMODB_TABLE_PREFIX` (opcional) |
| OpenAI / agente | `OPENAI_API_KEY`, `OPENAI_CHAT_MODEL`, … (ver [AGENTS.md](AGENTS.md)) |
| Pinecone | `PINECONE_API_KEY`, `PINECONE_INDEX` |
| Evolution (agente) | `EVOLUTION_SERVER_URL`, `EVOLUTION_ADMIN_API_KEY`, `AGENT_WEBHOOK_PUBLIC_URL` |
| Agente (opcional) | `AGENT_BUFFER_SECONDS`, `AGENT_SESSION_TIMEOUT_MINUTES`, `AGENT_TYPING_DELAY_MS` |
| Recordatorios | `REMINDER_INTERNAL_API_KEY` (+ config Meta en DynamoDB vía panel admin) |

Crea las tablas DynamoDB antes del primer arranque: ver [docs/DYNAMODB.md](docs/DYNAMODB.md).

Para S3: bucket con CORS si subes desde el front; imágenes de curso pueden ser públicas bajo `courses/*`; PDFs de módulo vía URLs firmadas.

## Scripts útiles

| Script | Uso |
|--------|-----|
| `scripts/create-dynamodb-tables.js` | Crear tablas en AWS |
| `scripts/deploy-pm2.sh` | Build + reinicio PM2 en EC2 |
| `scripts/generate-token.js` | Generar JWT de prueba (desarrollo) |
| `scripts/reset-agent-progress.js` | Resetear progreso del agente |
| `scripts/smoke-course-e2e.js` | Validar curso / S3 / Pinecone |
| `scripts/check-evolution.mjs` | Diagnóstico conexión Evolution |

## Documentación

- [AGENTS.md](AGENTS.md) — agente Nedi, convenciones, variables
- [docs/API.md](docs/API.md) — endpoints
- [docs/DYNAMODB.md](docs/DYNAMODB.md) — tablas y creación

## Estructura (resumen)

```
src/
├── controllers/    # Rutas HTTP
├── services/       # Lógica de negocio
│   └── agent/      # Agente Nedi (WhatsApp)
├── models/         # DTOs y entidades
├── strategies/     # JWT
└── main.ts
```

## Comandos npm

- `npm run start:dev` — desarrollo con recarga
- `npm run build` — compila a `dist/`
- `npm run start:prod` — `node dist/main.js` (lo usa PM2)
- `npm run lint` — eslint --fix
