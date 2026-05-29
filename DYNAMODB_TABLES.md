# Tablas DynamoDB del proyecto IA Learning

Este documento describe las tablas que usa el backend y cómo crearlas en una cuenta AWS nueva.

**Preguntas por curso/módulo:** el banco de preguntas generado una sola vez por combinación curso + módulo vive en **`CourseModuleProgress`** (PK `courseId`, SK `moduleId`). El estado por estudiante (por ejemplo avance o índice de pregunta) puede seguir en **`Progress`** (PK `phoneNumber`, SK `moduleId`). El backend Nest sigue usando **`ModuleProgress`** para completar módulos; alinea n8n y otros workers con las tablas que realmente lean/escriban.

> **Nombre en n8n:** algunos workflows o snapshots pueden referir la tabla como `CourseModuleQuestions`. El esquema es el mismo (PK `courseId`, SK `moduleId`); unifica el nombre de tabla en AWS, en el script y en los nodos DynamoDB de n8n.

## Resumen de tablas

| Tabla            | Clave primaria (PK) | Índices secundarios (GSI) |
|------------------|---------------------|---------------------------|
| **Users**        | `id` (String)       | `email-index` (PK: email) |
| **Courses**      | `id` (String)       | `instructorId-index` (PK: instructorId) |
| **CourseModules**| `id` (String)       | `courseId-order-index` (PK: courseId, SK: order), `courseId-status-index` (PK: courseId, SK: status) |
| **CourseModuleProgress** | `courseId` (String), `moduleId` (String) | — |
| **ModuleProgress** | `id` (String)     | — |
| **Progress**     | `phoneNumber` (String), `moduleId` (String) | — |
| **CourseGamification** | `phoneNumber` (String), `courseId` (String) | — |
| **Students**     | `id` (String)       | `courseId-index` (PK: courseId), `phoneNumber-index` (PK: phoneNumber) |
| **Workflows**    | `id` (String)       | `ownerId-index` (PK: ownerId) |
| **Credentials**  | `id` (String)       | `instructorId-index` (PK: instructorId) |
| **TokenBlacklist** | `token` (String)  | — |

---

## Esquema detallado por tabla

### 1. Users
- **Nombre:** `Users` (o `{prefix}Users` si usas `DYNAMODB_TABLE_PREFIX`)
- **Partition key:** `id` (String)
- **GSI:** `email-index` — Partition key: `email` (String). Permite buscar usuario por email en login.

### 2. Courses
- **Nombre:** `Courses`
- **Partition key:** `id` (String)
- **GSI:** `instructorId-index` — Partition key: `instructorId` (String). Lista cursos por instructor.

### 3. CourseModules
- **Nombre:** `CourseModules`
- **Partition key:** `id` (String)
- **GSI 1:** `courseId-order-index` — PK: `courseId` (String), Sort key: `order` (Number). Módulos de un curso ordenados.
- **GSI 2:** `courseId-status-index` — PK: `courseId` (String), Sort key: `status` (String). Módulos por estado (draft/published).

### 4. CourseModuleProgress
- **Nombre:** `CourseModuleProgress` (o `{prefix}CourseModuleProgress` con `DYNAMODB_TABLE_PREFIX`)
- **Partition key:** `courseId` (String)
- **Sort key:** `moduleId` (String)
- **Sin GSI:** acceso típico con `GetItem` / `Query` por `courseId`.
- **Uso previsto:** un ítem por par curso+módulo con atributos como `questions` (lista JSON), `createdAt`, `updatedAt`, etc. Las preguntas se numeran 1…N **por módulo** (independiente de otros módulos del mismo curso).

### 5. ModuleProgress
- **Nombre:** `ModuleProgress`
- **Partition key:** `id` (String). En la app es compuesto: `{phoneNumber}#{moduleId}`.
- Sin GSI (se usan Scan con FilterExpression donde hace falta).

### 6. Progress
- **Nombre:** `Progress`
- **Partition key:** `phoneNumber` (String)
- **Sort key:** `moduleId` (String)
- Sin GSI.

### 7. CourseGamification
- **Nombre:** `CourseGamification`
- **Partition key:** `phoneNumber` (String) — teléfono normalizado sin `+` ni prefijo `wa`
- **Sort key:** `courseId` (String)
- Sin GSI.
- **Uso:** puntos, nivel, racha y estadísticas de gamificación **por curso** (independiente entre cursos).

### 8. Students
- **Nombre:** `Students`
- **Partition key:** `id` (String)
- **GSI 1:** `courseId-index` — Partition key: `courseId` (String). Estudiantes por curso.
- **GSI 2:** `phoneNumber-index` — Partition key: `phoneNumber` (String). Estudiantes por teléfono.

### 9. Workflows
- **Nombre:** `Workflows`
- **Partition key:** `id` (String)
- **GSI:** `ownerId-index` — Partition key: `ownerId` (String). Workflows por dueño (instructor).

### 10. Credentials (n8n)
- **Nombre:** `Credentials`
- **Partition key:** `id` (String)
- **GSI:** `instructorId-index` — Partition key: `instructorId` (String). Credenciales por instructor.

### 11. TokenBlacklist
- **Nombre:** `TokenBlacklist`
- **Partition key:** `token` (String). JWT que se invalidó (logout).
- Sin GSI.

---

## Cómo crear las tablas en una cuenta AWS nueva

### Opción A: Script Node.js (recomendado)

1. Configura credenciales AWS (variables de entorno o `~/.aws/credentials`):
   ```bash
   export AWS_REGION=us-east-1
   export AWS_ACCESS_KEY_ID=tu_access_key
   export AWS_SECRET_ACCESS_KEY=tu_secret_key
   ```

2. (Opcional) Prefijo para entornos:
   ```bash
   export DYNAMODB_TABLE_PREFIX=dev_   # Tablas: dev_Users, dev_Courses, ...
   # O déjalo vacío para: Users, Courses, ...
   ```

3. Ejecuta el script desde la raíz del backend:
   ```bash
   cd /ruta/a/ia-learning-backend
   node scripts/create-dynamodb-tables.js
   ```

El script crea todas las tablas y GSIs; si una tabla ya existe, la omite.

### Opción B: Consola AWS

Puedes crear cada tabla manualmente en DynamoDB → Tables → Create table usando los nombres y claves de la tabla de resumen y la sección de esquema detallado.

### Opción C: AWS CLI

Ver ejemplos en `scripts/create-dynamodb-tables-cli.sh` (si se añade) o usar el script Node.js.

---

## Variables de entorno para el backend

En la nueva cuenta AWS configura en tu `.env` o entorno:

```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

# Opcional: prefijo para tablas (ej. dev_, prod_). Dejar vacío para nombres sin prefijo.
DYNAMODB_TABLE_PREFIX=
```

Los nombres de tabla que usa el código serán `{DYNAMODB_TABLE_PREFIX}{NombreTabla}` (por ejemplo `dev_Users`). Si no defines prefijo, se usan exactamente: `Users`, `Courses`, etc.
