# 🔍 API de Búsqueda de Usuarios por Email (Admin)

## 🎯 Endpoint

```
GET /users/search/:email
```

**Nota**: Solo accesible para usuarios con rol `ADMIN`. Requiere autenticación JWT.

## 🔐 Autenticación y Autorización

- **Autenticación**: JWT token válido requerido
- **Autorización**: Solo usuarios con rol `ADMIN`
- **Seguridad**: Las contraseñas se excluyen automáticamente de la respuesta

## 📋 Parámetros

### Path Parameters
| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `email` | string | Sí | Email o parte del email a buscar |

### Query Parameters
| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `cursor` | string | No | - | Cursor para la siguiente página (base64 encoded) |
| `sortOrder` | string | No | asc | Orden: 'asc' o 'desc' |

**Nota**: El límite está fijo en 10 usuarios por página. Solo se puede usar `cursor` O `sortOrder`, no ambos a la vez.

## 🔧 Ejemplos de Uso

### Buscar usuarios sin paginación
```bash
GET /users/search/admin
```

### Primera página con paginación
```bash
GET /users/search/admin?sortOrder=asc
```

### Siguiente página
```bash
GET /users/search/admin?cursor=eyJpZCI6InVzZXItMTIzIn0=&sortOrder=asc
```

### Con orden descendente
```bash
GET /users/search/admin?sortOrder=desc
```

### Búsquedas específicas
```bash
# Buscar por dominio
GET /users/search/@gmail.com

# Buscar por nombre de usuario
GET /users/search/john

# Buscar por email completo
GET /users/search/admin@example.com
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
    "email": "admin2@example.com",
    "name": "Administrador 2",
    "role": "admin",
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

### Sin resultados
```json
[]
```

## 🔄 Flujo de Paginación

1. **Primera búsqueda**: `GET /users/search/admin?sortOrder=asc`
2. **Siguiente página**: Usar `nextCursor` de la respuesta anterior
3. **Continuar**: Repetir hasta que `hasNext` sea `false`

## ✅ Ventajas de la Búsqueda

- ✅ **Búsqueda parcial**: Encuentra emails que contengan el término buscado
- ✅ **Case insensitive**: No distingue entre mayúsculas y minúsculas
- ✅ **Paginación**: Soporta paginación para grandes resultados
- ✅ **Consistencia**: Mismo formato que otros endpoints
- ✅ **Seguridad**: Solo administradores pueden buscar usuarios

## 🔍 Casos de Uso Comunes

### Buscar usuarios por dominio
```bash
# Todos los usuarios de Gmail
GET /users/search/@gmail.com

# Todos los usuarios de la empresa
GET /users/search/@company.com
```

### Buscar usuarios por nombre
```bash
# Usuarios con "john" en el email
GET /users/search/john

# Usuarios con "admin" en el email
GET /users/search/admin
```

### Buscar usuarios específicos
```bash
# Email exacto
GET /users/search/user@example.com

# Parte del email
GET /users/search/example.com
```

## 🔧 Implementación en Frontend

```javascript
// Función para buscar usuarios por email
async function searchUsersByEmail(email, cursor = null, sortOrder = null) {
  const params = new URLSearchParams();
  
  if (cursor) params.append('cursor', cursor);
  if (sortOrder) params.append('sortOrder', sortOrder);
  
  const response = await fetch(`/users/search/${encodeURIComponent(email)}?${params}`, {
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

// Buscar usuarios sin paginación
const users = await searchUsersByEmail('admin');
console.log('Usuarios encontrados:', users);

// Buscar con paginación
const firstPage = await searchUsersByEmail('admin', null, 'asc');
console.log('Primera página:', firstPage.data);

// Navegar hacia adelante
if (firstPage.pagination.hasNext) {
  const secondPage = await searchUsersByEmail('admin', firstPage.pagination.nextCursor, 'asc');
  console.log('Segunda página:', secondPage.data);
}
```

## 🔍 Casos de Uso Avanzados

### Búsqueda con autocompletado
```javascript
async function searchUsersAutocomplete(searchTerm) {
  if (searchTerm.length < 2) return [];
  
  const users = await searchUsersByEmail(searchTerm);
  return users.map(user => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role
  }));
}
```

### Búsqueda con filtros
```javascript
async function searchUsersWithFilters(email, role = null) {
  const users = await searchUsersByEmail(email);
  
  if (role) {
    return users.filter(user => user.role === role);
  }
  
  return users;
}
```

### Estadísticas de búsqueda
```javascript
async function getSearchStats(email) {
  const users = await searchUsersByEmail(email);
  
  const stats = {
    total: users.length,
    byRole: {
      admin: users.filter(u => u.role === 'admin').length,
      instructor: users.filter(u => u.role === 'instructor').length,
      student: users.filter(u => u.role === 'student').length
    },
    domains: {}
  };
  
  // Agrupar por dominio
  users.forEach(user => {
    const domain = user.email.split('@')[1];
    stats.domains[domain] = (stats.domains[domain] || 0) + 1;
  });
  
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

### Email no encontrado
```json
[]
```

## 📝 Notas Importantes

1. **Búsqueda parcial**: Usa `contains()` para búsquedas parciales
2. **Case insensitive**: DynamoDB `contains()` no distingue mayúsculas/minúsculas
3. **Límite fijo**: 10 usuarios por página (no configurable)
4. **Paginación unidireccional**: Solo soporta navegación hacia adelante
5. **Seguridad**: Las contraseñas nunca se incluyen en la respuesta
6. **Acceso**: Solo administradores pueden acceder a este endpoint
7. **Operación**: Utiliza DynamoDB Scan con FilterExpression

## 🆚 Comparación con otros endpoints

| Endpoint | Acceso | Búsqueda | Paginación | Límite |
|----------|--------|----------|-------------|--------|
| `/users` | Solo Admin | ❌ | Cursor-based | 10 |
| `/users/search/:email` | Solo Admin | ✅ | Cursor-based | 10 |
| `/users/:id` | Solo Admin | ❌ | ❌ | 1 |

## 🔄 Ejemplos de Postman

### Request básico
```
GET http://localhost:3000/users/search/admin
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
  Content-Type: application/json
```

### Request con paginación
```
GET http://localhost:3000/users/search/admin?sortOrder=asc
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
  Content-Type: application/json
```

### Request con cursor
```
GET http://localhost:3000/users/search/admin?cursor=eyJpZCI6InVzZXItMTIzIn0=&sortOrder=asc
Headers:
  Authorization: Bearer YOUR_JWT_TOKEN
  Content-Type: application/json
```
