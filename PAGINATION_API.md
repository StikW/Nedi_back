# 📄 API de Paginación - Cursos por Instructor

## 🎯 Endpoint

```
GET /courses
```

**Nota**: El mismo endpoint maneja tanto la respuesta completa como la paginada según los parámetros proporcionados.

## 📋 Parámetros de Query

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `cursor` | string | No | - | Cursor para la siguiente página |
| `sortOrder` | string | No | desc | Orden: 'asc' o 'desc' |

**Nota**: El límite está fijo en 1 curso por página.

## 🔧 Ejemplos de Uso

### Obtener todos los cursos (comportamiento original)
```bash
GET /courses
```

### Primera página con paginación
```bash
GET /courses?sortOrder=desc
```

### Siguiente página
```bash
GET /courses?cursor=eyJpZCI6ImNvdXJzZS0xMjMifQ==&sortOrder=desc
```

### Con orden ascendente
```bash
GET /courses?sortOrder=asc
```

## 📊 Respuesta

### Sin parámetros de paginación (comportamiento original)
```json
[
  {
    "id": "course-123",
    "title": "Curso de JavaScript",
    "description": "Aprende JavaScript desde cero",
    "category": "programming",
    "imageUrl": "https://example.com/image.jpg",
    "objectives": "Objetivos del curso",
    "prerequisites": "Conocimientos básicos",
    "status": "published",
    "instructorId": "instructor-456",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
]
```

### Con parámetros de paginación
```json
{
  "data": [
    {
      "id": "course-123",
      "title": "Curso de JavaScript",
      "description": "Aprende JavaScript desde cero",
      "category": "programming",
      "imageUrl": "https://example.com/image.jpg",
      "objectives": "Objetivos del curso",
      "prerequisites": "Conocimientos básicos",
      "status": "published",
      "instructorId": "instructor-456",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "limit": 1,
    "hasNext": true,
    "nextCursor": "eyJpZCI6ImNvdXJzZS0xMjMifQ==",
    "sortOrder": "desc"
  }
}
```

## 🔄 Flujo de Paginación

1. **Primera solicitud**: No incluir `cursor`
2. **Siguiente página**: Usar `nextCursor` de la respuesta anterior
3. **Verificar más páginas**: Usar `hasNext` para saber si hay más datos

## ⚡ Ventajas de la Paginación por Cursor

- ✅ **Eficiente**: No necesita contar todos los registros
- ✅ **Consistente**: No se ve afectada por cambios en los datos
- ✅ **Escalable**: Funciona bien con grandes volúmenes de datos
- ✅ **DynamoDB optimizado**: Usa `ExclusiveStartKey` nativo

## 🚫 Limitaciones

- ❌ **No navegación hacia atrás**: Solo hacia adelante
- ❌ **No salto a página específica**: Solo secuencial
- ❌ **No conteo total**: No se proporciona el número total de registros

## 🔧 Implementación en Frontend

```javascript
// Función para obtener cursos (con o sin paginación)
async function getCourses(cursor = null, sortOrder = null) {
  const params = new URLSearchParams();
  
  if (cursor) params.append('cursor', cursor);
  if (sortOrder) params.append('sortOrder', sortOrder);
  
  const response = await fetch(`/courses?${params}`);
  return await response.json();
}

// Ejemplos de uso

// Obtener todos los cursos (comportamiento original)
const allCourses = await getCourses();
console.log('Todos los cursos:', allCourses);

// Obtener primera página con paginación
const firstPage = await getCourses(null, 'desc');
console.log('Primera página:', firstPage.data);

// Navegar hacia adelante
if (firstPage.pagination.hasNext) {
  const secondPage = await getCourses(firstPage.pagination.nextCursor, 'desc');
  console.log('Segunda página:', secondPage.data);
}
```

## 📝 Notas Importantes

1. **Cursor encoding**: Los cursors están codificados en base64
2. **Límite fijo**: 1 curso por página (no configurable)
3. **Ordenamiento**: Por defecto ordena por `createdAt` descendente
4. **Paginación unidireccional**: Solo soporta navegación hacia adelante
5. **Autenticación**: Requiere JWT token válido
6. **Permisos**: Solo muestra cursos del instructor autenticado
