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

## Progreso de módulos

Usado por integraciones (n8n, etc.). Requiere JWT.

`POST /module-progress/complete`

```json
{
  "phoneNumber": "51999999999",
  "moduleId": "uuid-modulo",
  "courseId": "uuid-curso",
  "timeSpentMinutes": 5
}
```

Respuesta: `{ "success": true, "message": "...", "progress": { ... } }`.

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

## Workflows y credenciales n8n

| Método | Ruta |
|--------|------|
| CRUD | `/workflows`, `/workflows/:id` |
| POST | `/workflows/:id/execute` |
| PUT | `/workflows/:id/activate`, `/deactivate` |
| CRUD | `/n8n-credentials` (+ `by-name/:name`, `by-n8n-id/:id_n8n`) |

## Recordatorios WhatsApp

Requieren `REMINDER_INTERNAL_API_KEY` en cabecera o body según implementación del controlador.

| Método | Ruta |
|--------|------|
| POST | `/reminders/run`, `/run/welcome`, `/run/daily`, `/run/weekly`, `/run/all` |
| GET | `/reminders/preview` |
| POST | `/reminders/check` |

## Paginación

Endpoints que devuelven listas paginadas usan cursor opaco:

- Query: `cursor` (opcional), `sortOrder` (`asc` | `desc`)
- Respuesta: `data`, `pagination: { limit, hasNext, nextCursor }`
- Tamaño de página fijo en código (típicamente 10)
