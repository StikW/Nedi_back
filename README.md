# Backend Nedi (NestJS)

API de la plataforma Tututor: cursos, estudiantes, uploads S3, progreso de módulos, recordatorios WhatsApp e integración n8n.

## Requisitos

- Node.js 18+
- Cuenta AWS (DynamoDB, S3)
- `.env` en la raíz de `backup_back/` (no versionar)

## Instalación local

```bash
cd backup_back
npm install
# Crea .env con las variables de la sección siguiente
npm run start:dev
```

Servidor: `http://localhost:3000` — health: `GET /health` (sin prefijo `/api` en local según `main.ts`; en producción nginx suele exponer `/api/health`).

## Despliegue en servidor (PM2)

`git pull` **no** regenera `dist/`. Tras cada actualización de código:

```bash
cd backup_back
./scripts/deploy-pm2.sh ia-learning-backend
```

El script ejecuta `npm install`, `npm run build` y reinicia PM2. Verifica:

```bash
curl -s http://127.0.0.1:3000/health
curl -s https://dev.tututor.co/api/health
```

## Variables de entorno

| Grupo | Variables |
|-------|-----------|
| AWS | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| S3 | `S3_BUCKET`, `S3_BUCKET_MODULES` |
| JWT | `JWT_SECRET`, `JWT_EXPIRES_IN` |
| DynamoDB | `DYNAMODB_TABLE_PREFIX` (opcional) |
| n8n | `N8N_BASE_URL`, `N8N_API_KEY` |
| WhatsApp | `WHATSAPP_API_VERSION`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, plantillas `WHATSAPP_*_TEMPLATE_*` |
| Recordatorios | `REMINDER_INTERNAL_API_KEY`, `REMINDER_CRON_ENABLED`, `REMINDER_CRON_TIMEZONE`, crons y modo test (`REMINDER_TEST_*`, `REMINDER_DAILY_CRON_SCHEDULE`, …) |

Crea las tablas DynamoDB antes del primer arranque: ver [docs/DYNAMODB.md](docs/DYNAMODB.md).

Para S3: bucket con CORS si subes desde el front; imágenes de curso pueden ser públicas bajo `courses/*`; vídeos/documentos vía URLs firmadas.

## Scripts útiles

| Script | Uso |
|--------|-----|
| `scripts/create-dynamodb-tables.js` | Crear tablas en AWS |
| `scripts/deploy-pm2.sh` | Build + reinicio PM2 en EC2 |
| `scripts/generate-token.js` | Generar JWT de prueba (desarrollo) |

## Documentación

- [docs/API.md](docs/API.md) — endpoints
- [docs/DYNAMODB.md](docs/DYNAMODB.md) — tablas y creación

## Estructura (resumen)

```
src/
├── controllers/    # Rutas HTTP
├── services/       # Lógica de negocio
├── models/         # DTOs y entidades
├── strategies/     # JWT
└── main.ts
```

## Comandos npm

- `npm run start:dev` — desarrollo con recarga
- `npm run build` — compila a `dist/`
- `npm run start:prod` — `node dist/main.js` (lo usa PM2)
