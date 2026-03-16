# Tablas DynamoDB del proyecto IA Learning

Este documento describe las tablas que usa el backend y cómo crearlas en una cuenta AWS nueva.

## Resumen de tablas

| Tabla            | Clave primaria (PK) | Índices secundarios (GSI) |
|------------------|---------------------|---------------------------|
| **Users**        | `id` (String)       | `email-index` (PK: email) |
| **Courses**      | `id` (String)       | `instructorId-index` (PK: instructorId) |
| **CourseModules**| `id` (String)       | `courseId-order-index` (PK: courseId, SK: order), `courseId-status-index` (PK: courseId, SK: status) |
| **ModuleProgress** | `id` (String)     | — |
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

### 4. ModuleProgress
- **Nombre:** `ModuleProgress`
- **Partition key:** `id` (String). En la app es compuesto: `{phoneNumber}#{moduleId}`.
- Sin GSI (se usan Scan con FilterExpression donde hace falta).

### 5. Students
- **Nombre:** `Students`
- **Partition key:** `id` (String)
- **GSI 1:** `courseId-index` — Partition key: `courseId` (String). Estudiantes por curso.
- **GSI 2:** `phoneNumber-index` — Partition key: `phoneNumber` (String). Estudiantes por teléfono.

### 6. Workflows
- **Nombre:** `Workflows`
- **Partition key:** `id` (String)
- **GSI:** `ownerId-index` — Partition key: `ownerId` (String). Workflows por dueño (instructor).

### 7. Credentials (n8n)
- **Nombre:** `Credentials`
- **Partition key:** `id` (String)
- **GSI:** `instructorId-index` — Partition key: `instructorId` (String). Credenciales por instructor.

### 8. TokenBlacklist
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
