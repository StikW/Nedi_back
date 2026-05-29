# API de Progreso de Módulos

Este documento describe los endpoints disponibles para manejar el progreso de módulos de los estudiantes.

## Otras tablas DynamoDB relacionadas

- **`ModuleProgress`**: lo que usa este API Nest (completar módulo; clave `id` compuesta). Detalle en `DYNAMODB_TABLES.md`.
- **`CourseModuleProgress`**: banco de preguntas **una vez por curso y módulo** (PK `courseId`, SK `moduleId`). No forma parte de los endpoints de este documento; ver `DYNAMODB_TABLES.md`.
- **`Progress`**: estado por estudiante y módulo (p. ej. WhatsApp/n8n). Ver `DYNAMODB_TABLES.md`.

## Endpoint Principal: Completar Módulo

### POST `/module-progress/complete-module`

Registra cuando un estudiante completa un módulo en la tabla `ModuleProgress` de DynamoDB.

#### Headers
```
Authorization: Bearer <jwt_token>
Content-Type: application/json
```

#### Body
```json
{
  "phoneNumber": "string",
  "moduleId": "string", 
  "courseId": "string",
  "timeSpentMinutes": 120  // opcional
}
```

#### Respuesta Exitosa (200)
```json
{
  "success": true,
  "message": "Módulo completado exitosamente",
  "progress": {
    "id": "573001234567#module-456",
    "phoneNumber": "573001234567",
    "moduleId": "module-456",
    "courseId": "course-789",
    "timeSpentMinutes": 120,
    "completedAt": "2024-01-01T12:00:00.000Z"
  }
}
```

## Otros Endpoints Disponibles

### 1. Crear Progreso de Módulo
**POST** `/module-progress`
```json
{
  "phoneNumber": "string",
  "moduleId": "string",
  "courseId": "string", 
  "timeSpentMinutes": 60
}
```

### 2. Obtener Progreso por Teléfono y Módulo
**GET** `/module-progress/phone/{phoneNumber}/module/{moduleId}`

### 3. Obtener Todos los Progresos de un Estudiante
**GET** `/module-progress/phone/{phoneNumber}`

### 4. Obtener Progreso de Estudiante en un Curso
**GET** `/module-progress/phone/{phoneNumber}/course/{courseId}`

### 5. Obtener Todos los Progresos de un Módulo
**GET** `/module-progress/module/{moduleId}`

## Estructura de la Tabla DynamoDB

La tabla `ModuleProgress` tiene una estructura simplificada:

- **Primary Key**: `id` (String) - Formato: `phoneNumber#moduleId`
  - Ejemplo: `573001234567#module-456`
- **No se requieren índices adicionales** ya que el ID compuesto permite acceso directo

## Ejemplo de Uso

```bash
curl -X POST "http://localhost:3000/module-progress/complete" \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "573001234567",
    "moduleId": "module-456", 
    "courseId": "course-789",
    "timeSpentMinutes": 90
  }'
```
