# API REST (NestJS)

Base URL en servidor: `https://tututor.co/api` (Nginx reenvía `/api/*` al proceso Nest en el puerto 3000).
Rutas en Nest: sin prefijo `/api` (por ejemplo `POST /auth/login` en local es `http://localhost:3000/auth/login`).

## Autenticación

La mayoría de rutas requieren `Authorization: Bearer <JWT>`.

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/register` | Registro |
| POST | `/auth/login` | Login |
| POST | `/auth/logout` | Invalidar token |
| POST | `/auth/change-password` | Cambio de contraseña |
| GET | `/auth/me` | Usuario actual |
| PUT | `/auth/me` | Actualizar perfil |

## Público (sin JWT)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/health` | Estado del servicio |
| GET | `/config/public` | Config pública para el front |
| GET | `/public/courses/:courseId/preview` | Vista previa del curso |
| POST | `/public/courses/:courseId/enroll` | Inscripción pública |

## Cursos y módulos

| Método | Ruta | Notas |
|--------|------|-------|
| POST/GET | `/courses` | Listado con paginación por cursor (`cursor`, `sortOrder`) |
| GET | `/courses/instructor/stats` | Estadísticas del instructor |
| GET/PUT/DELETE | `/courses/:id` | CRUD |
| GET | `/courses/:id/stats` | Stats del curso |
| GET | `/courses/:id/student-progress` | Progreso de estudiantes |
| GET | `/courses/:id/student-progress/:phoneNumber` | Progreso de un alumno |
| POST/GET | `/courses/:courseId/modules` | Módulos del curso |
| GET | `/courses/:courseId/modules/published` | Solo publicados |
| GET/PUT/DELETE | `/courses/:courseId/modules/:id` | CRUD módulo |
| PUT | `/courses/:courseId/modules/reorder` | Reordenar |

### Campos del módulo (create / update)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `title` | string | Título |
| `description` | string | Descripción |
| `order` | number | Orden en el curso |
| `status` | `draft` \| `published` \| `archived` | Estado |
| `content` | URL (opcional) | URL del **video** del módulo (UI: "URL del video") |
| `activityUrl` | URL (opcional) | URL de **actividad** externa (Wordwall, Google Forms, …) |
| `resources` | array | PDFs del módulo (`name`, `url`, `size?`) |

En **update**, enviar `content: ""` o `activityUrl: ""` elimina ese enlace del módulo.

## Estudiantes

| Método | Ruta | Notas |
|--------|------|-------|
| POST | `/students` | Alta |
| GET | `/students/course/:courseId` | Paginación: query `cursor`, `sortOrder` (10 por página) |
| GET/PUT/DELETE | `/students/:id` | CRUD |
| GET | `/students/search/phone` | Búsqueda por teléfono |
| GET | `/students/check/:courseId/:phoneNumber` | ¿Inscrito? |
| POST | `/students/course/:courseId/import` | Importación masiva |
| GET | `/students/:phoneNumber/stats` | Estadísticas |

## Usuarios (admin)

| Método | Ruta | Notas |
|--------|------|-------|
| GET | `/users` | Paginación por cursor |
| GET | `/users/search/:email` | Búsqueda por email |
| GET/PUT | `/users/:id` | Detalle / actualización |

## Agente Nedi (WhatsApp / Evolution)

| Método | Ruta | Auth | Descripción |
|--------|------|------|-------------|
| POST | `/agent/webhook` | — | Webhook Evolution (mensajes entrantes) |
| POST | `/agent/evolution/connect` | JWT | Conectar WhatsApp (QR) + configurar webhook |
| GET | `/agent/evolution/status` | JWT | Estado de conexión |
| GET | `/agent/evolution/health` | JWT | Diagnóstico Evolution |
| POST | `/agent/evolution/logout` | JWT | Desvincular número |

## Admin — conversaciones y logs del agente

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/admin/agent/conversations/instructors` | Instructores con Evolution |
| GET | `/admin/agent/conversations/:instructorId/chats` | Chats de un instructor |
| GET | `/admin/agent/conversations/:instructorId/messages` | Mensajes de un chat |
| GET | `/admin/agent/logs` | Log de actividad del agente |
| GET | `/admin/agent/logs/file` | Log en archivo |

## Admin — notificaciones Meta

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET/PUT | `/admin/notification-config` | Config recordatorios WhatsApp (Meta) |

## Progreso de módulos

Requiere JWT.

`POST /module-progress/complete`

```json
{
  "phoneNumber": "51999999999",
  "moduleId": "uuid-modulo",
  "courseId": "uuid-curso",
  "timeSpentMinutes": 5
}
```

## Uploads (S3)

| Método | Ruta |
|--------|------|
| POST | `/uploads/presigned-url` |
| POST | `/uploads/course/presigned-url` |
| POST | `/uploads/module/presigned-url` |
| POST | `/uploads/module/trigger-vectorization` |
| GET | `/uploads/:courseId/:fileKey` |
| GET | `/uploads/course/:courseId/:fileKey` |
| GET | `/uploads/module/:courseId/:moduleId/:fileKey` |

## Recordatorios WhatsApp (Meta)

Requieren `REMINDER_INTERNAL_API_KEY` en cabecera o body.

| Método | Ruta |
|--------|------|
| POST | `/reminders/run`, `/run/welcome`, `/run/daily`, `/run/weekly`, `/run/all` |
| GET | `/reminders/preview` |
| POST | `/reminders/check` |

## Paginación

Endpoints paginados usan cursor opaco:

- Query: `cursor` (opcional), `sortOrder` (`asc` | `desc`)
- Respuesta: `data`, `pagination: { limit, hasNext, nextCursor }`
- Tamaño de página fijo en código (típicamente 10)
