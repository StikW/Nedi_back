# Gamificación Fase 1 — Nedi

Puntos por respuesta correcta y subida de nivel al completar módulos, **por curso**.

## Backend

### Tabla DynamoDB: `CourseGamification`

| PK | SK | Campos |
|----|-----|--------|
| `phoneNumber` | `courseId` | `points`, `level`, `currentStreak`, `bestStreak`, `correctAnswers`, `totalAnswers`, `updatedAt` |

Crear la tabla:

```bash
cd backup_back
node scripts/create-dynamodb-tables.js
```

### Endpoints

#### `POST /gamification/answer` (JWT, mismo auth que `finish_module`)

```json
{ "phoneNumber": "573001234567", "courseId": "course-uuid", "isCorrect": true }
```

Respuesta:

```json
{
  "success": true,
  "gamification": {
    "points": 120,
    "level": 1,
    "currentStreak": 3,
    "bestStreak": 5,
    "pointsEarned": 10,
    "leveledUp": false,
    "message": "+10 pts (Total: 120) | Racha: 3 🔥"
  }
}
```

#### `POST /module-progress/complete` (extendido)

Ahora incluye `gamification` en la respuesta:

```json
{
  "success": true,
  "message": "¡Subiste al nivel 2! +25 pts bonus. Total: 145 pts",
  "progress": { ... },
  "gamification": {
    "level": 2,
    "points": 145,
    "leveledUp": true,
    "message": "..."
  }
}
```

### Reglas

| Evento | Efecto |
|--------|--------|
| Respuesta correcta | +10 pts, racha +1 |
| Respuesta incorrecta | racha = 0 |
| Módulo completado (nuevo) | nivel = módulos completados del curso, +25 pts bonus |

## n8n (Flujo principal Instructor Peru)

Cambios aplicados vía `scripts/patch-n8n-gamification.py`:

1. **Nodo tool** `register_gamification` → `POST .../gamification/answer`
2. **AI Respuestas**: prompt para llamar la tool tras validar
3. **AI Preguntas**: prompt para anunciar subida de nivel tras `finish_module`

Re-aplicar el patch si hace falta:

```bash
export N8N_API_KEY=...
python3 scripts/patch-n8n-gamification.py
```

## Despliegue

1. Desplegar backend con los nuevos endpoints en `dev.tututor.co`
2. Crear tabla `CourseGamification` en AWS
3. El flujo n8n en dev ya está parcheado

## Prueba manual

1. Iniciar curso por WhatsApp
2. Responder una pregunta correctamente → debe mencionar puntos/racha
3. Completar todas las preguntas del módulo → debe anunciar subida de nivel
