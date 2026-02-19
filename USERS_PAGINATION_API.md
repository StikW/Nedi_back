# 👥 API de Paginación de Usuarios (Admin)

## 🎯 Endpoint

```
GET /users
```

**Nota**: Solo accesible para usuarios con rol `ADMIN`. Requiere autenticación JWT.

## 🔐 Autenticación y Autorización

- **Autenticación**: JWT token válido requerido
- **Autorización**: Solo usuarios con rol `ADMIN`
- **Seguridad**: Las contraseñas se excluyen automáticamente de la respuesta

## 📋 Parámetros de Query

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `cursor` | string | No | - | Cursor para la siguiente página (base64 encoded) |
| `sortOrder` | string | No | asc | Orden: 'asc' o 'desc' |

**Nota**: El límite está fijo en 10 usuarios por página. Solo se puede usar `cursor` O `sortOrder`, no ambos a la vez.

## 🔧 Ejemplos de Uso

### Obtener todos los usuarios (comportamiento original)
```bash
GET /users
```

### Primera página con paginación
```bash
GET /users?sortOrder=asc
```

### Siguiente página
```bash
GET /users?cursor=eyJpZCI6InVzZXItMTIzIn0=&sortOrder=asc
```

### Con orden descendente
```bash
GET /users?sortOrder=desc
```

## 📊 Respuesta

### Sin parámetros de paginación (comportamiento original)
```json
[
  {
    "id": "user-123",
    "email": "admin@example.com",
    "name": "Administrador",
    "role": "admin",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z",
    "clientIdApp": "optional-client-id",
    "clientSecretApp": "optional-client-secret",
    "businessAccountId": "optional-business-id",
    "accessToken": "optional-access-token"
  },
  {
    "id": "user-124",
    "email": "instructor@example.com",
    "name": "Instructor",
    "role": "instructor",
    "createdAt": "2024-01-16T09:15:00.000Z",
    "updatedAt": "2024-01-16T09:15:00.000Z"
  }
]
```

### Con parámetros de paginación
```json
{
  "data": [
    {
      "id": "user-123",
      "email": "admin@example.com",
      "name": "Administrador",
      "role": "admin",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z",
      "clientIdApp": "optional-client-id",
      "clientSecretApp": "optional-client-secret",
      "businessAccountId": "optional-business-id",
      "accessToken": "optional-access-token"
    }
  ],
  "pagination": {
    "limit": 10,
    "hasNext": true,
    "nextCursor": "eyJpZCI6InVzZXItMTIzIn0=",
    "sortOrder": "asc"
  }
}
```

### Última página
```json
{
  "users": [
    {
      "id": "user-999",
      "email": "last@example.com",
      "name": "Último Usuario",
      "role": "student",
      "createdAt": "2024-01-20T14:45:00.000Z",
      "updatedAt": "2024-01-20T14:45:00.000Z"
    }
  ],
  "hasNext": false,
  "nextCursor": null,
  "total": 1
}
```

## 🔄 Flujo de Paginación

1. **Primera página**: `GET /users?limit=50`
2. **Siguiente página**: Usar `nextCursor` de la respuesta anterior
3. **Continuar**: Repetir hasta que `hasNext` sea `false`

## ✅ Ventajas de la Nueva Implementación

- ✅ **Seguridad mejorada**: Cursor base64 en lugar de JSON expuesto
- ✅ **Consistencia**: Mismo patrón que otros endpoints (`/courses`, `/students`, `/modules`)
- ✅ **Abstracción**: Oculta la estructura interna de DynamoDB
- ✅ **Validación**: Manejo robusto de cursors inválidos
- ✅ **Flexibilidad**: Límite configurable por página

## 🔧 Implementación en Frontend

```javascript
// Función para obtener usuarios (con paginación)
async function getUsers(limit = 50, cursor = null) {
  const params = new URLSearchParams();
  params.append('limit', limit.toString());
  
  if (cursor) params.append('cursor', cursor);
  
  const response = await fetch(`/users?${params}`, {
    headers: {
      'Authorization': `Bearer ${token}` // JWT token requerido
    }
  });
  
  if (!response.ok) {
    throw new Error(`Error ${response.status}: ${response.statusText}`);
  }
  
  return await response.json();
}

// Ejemplos de uso

// Obtener primera página
const firstPage = await getUsers(20);
console.log('Primera página:', firstPage.users);

// Navegar hacia adelante
if (firstPage.hasNext) {
  const secondPage = await getUsers(20, firstPage.nextCursor);
  console.log('Segunda página:', secondPage.users);
}
```

## 🔍 Casos de Uso Comunes

### Lista completa de usuarios con paginación
```javascript
async function getAllUsers() {
  let allUsers = [];
  let currentCursor = null;
  
  do {
    const response = await getUsers(50, currentCursor);
    allUsers = [...allUsers, ...response.users];
    currentCursor = response.nextCursor;
  } while (response.hasNext);
  
  return allUsers;
}
```

### Búsqueda de usuarios específicos
```javascript
async function searchUsers(searchTerm) {
  const allUsers = await getAllUsers();
  
  return allUsers.filter(user => 
    user.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
    user.role.toLowerCase().includes(searchTerm.toLowerCase())
  );
}
```

### Estadísticas de usuarios
```javascript
async function getUserStats() {
  const allUsers = await getAllUsers();
  
  const stats = {
    total: allUsers.length,
    byRole: {
      admin: allUsers.filter(u => u.role === 'admin').length,
      instructor: allUsers.filter(u => u.role === 'instructor').length,
      student: allUsers.filter(u => u.role === 'student').length
    },
    recent: allUsers.filter(u => 
      new Date(u.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    ).length
  };
  
  return stats;
}
```

## 🚨 Manejo de Errores

### Sin permisos de administrador
```json
{
  "statusCode": 403,
  "message": "Forbidden resource",
  "error": "Forbidden"
}
```

### Token JWT inválido o expirado
```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

### Cursor inválido
```javascript
// Si el cursor es inválido, la API simplemente ignora el cursor
// y retorna la primera página
const response = await getUsers(50, "invalid-cursor");
// Retorna la primera página normalmente
```

## 📝 Notas Importantes

1. **Cursor encoding**: Los cursors están codificados en base64
2. **Límite máximo**: Recomendado máximo 100 usuarios por página
3. **Ordenamiento**: DynamoDB Scan no garantiza orden específico
4. **Paginación unidireccional**: Solo soporta navegación hacia adelante
5. **Seguridad**: Las contraseñas nunca se incluyen en la respuesta
6. **Acceso**: Solo administradores pueden acceder a este endpoint
7. **Operación**: Utiliza DynamoDB Scan (más costoso que Query)

## 🆚 Comparación con otros endpoints

| Endpoint | Acceso | Paginación | Cursor | Límite |
|----------|--------|-------------|--------|--------|
| `/users` | Solo Admin | Cursor-based | base64 | Configurable |
| `/courses` | Instructor | Cursor-based | base64 | Fijo (10) |
| `/students/course/:id` | Instructor | Cursor-based | base64 | Fijo (10) |
| `/courses/:id/modules` | Instructor | Cursor-based | base64 | Fijo (10) |

## 🔄 Migración desde la versión anterior

### Antes (JSON directo):
```bash
GET /users?limit=50&lastEvaluatedKey={"id":"user-123"}
```

### Ahora (base64):
```bash
GET /users?limit=50&cursor=eyJpZCI6InVzZXItMTIzIn0=
```

### Cambios en la respuesta:
- `lastEvaluatedKey` → `nextCursor`
- Agregado `hasNext` para mejor UX
- Cursor ahora es base64 en lugar de JSON
