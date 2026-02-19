# 📚 API de Paginación de Módulos

## 🎯 Endpoint

```
GET /courses/:courseId/modules
```

**Nota**: El mismo endpoint maneja tanto la respuesta completa como la paginada según los parámetros proporcionados.

## 📋 Parámetros de Query

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `cursor` | string | No | - | Cursor para la siguiente página |
| `sortOrder` | string | No | asc | Orden: 'asc' o 'desc' |

**Nota**: El límite está fijo en 10 módulos por página.

## 🔧 Ejemplos de Uso

### Obtener todos los módulos (comportamiento original)
```bash
GET /courses/course-123/modules
```

### Primera página con paginación
```bash
GET /courses/course-123/modules?sortOrder=asc
```

### Siguiente página
```bash
GET /courses/course-123/modules?cursor=eyJpZCI6Im1vZHVsZS0xMjMifQ==&sortOrder=asc
```

### Con orden descendente
```bash
GET /courses/course-123/modules?sortOrder=desc
```

## 📊 Respuesta

### Sin parámetros de paginación (comportamiento original)
```json
[
  {
    "id": "module-123",
    "courseId": "course-456",
    "title": "Introducción al Módulo",
    "description": "Descripción del módulo",
    "order": 1,
    "status": "published",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  {
    "id": "module-124",
    "courseId": "course-456",
    "title": "Segundo Módulo",
    "description": "Descripción del segundo módulo",
    "order": 2,
    "status": "published",
    "createdAt": "2024-01-15T11:00:00.000Z",
    "updatedAt": "2024-01-15T11:00:00.000Z"
  }
]
```

### Con parámetros de paginación
```json
{
  "data": [
    {
      "id": "module-123",
      "courseId": "course-456",
      "title": "Introducción al Módulo",
      "description": "Descripción del módulo",
      "order": 1,
      "status": "published",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "hasNext": true,
    "nextCursor": "eyJpZCI6Im1vZHVsZS0xMjMifQ==",
    "sortOrder": "asc"
  }
}
```

## 🔄 Flujo de Paginación

1. **Primera página**: `GET /courses/:courseId/modules?sortOrder=asc`
2. **Siguiente página**: Usar `nextCursor` de la respuesta anterior
3. **Continuar**: Repetir hasta que `hasNext` sea `false`

## ✅ Ventajas de la Paginación

- ✅ **Performance**: Solo carga 10 módulos por vez
- ✅ **Escalabilidad**: Funciona con cursos que tienen muchos módulos
- ✅ **Consistencia**: Mismo patrón que la paginación de cursos
- ✅ **Flexibilidad**: Soporta ordenamiento ascendente y descendente

## ❌ Limitaciones

- ❌ **No salto a página específica**: Solo secuencial
- ❌ **No conteo total**: No se proporciona el número total de módulos

## 🔧 Implementación en Frontend

```javascript
// Función para obtener módulos (con o sin paginación)
async function getModules(courseId, cursor = null, sortOrder = null) {
  const params = new URLSearchParams();
  
  if (cursor) params.append('cursor', cursor);
  if (sortOrder) params.append('sortOrder', sortOrder);
  
  const response = await fetch(`/courses/${courseId}/modules?${params}`);
  return await response.json();
}

// Ejemplos de uso

// Obtener todos los módulos (comportamiento original)
const allModules = await getModules('course-123');
console.log('Todos los módulos:', allModules);

// Obtener primera página con paginación
const firstPage = await getModules('course-123', null, 'asc');
console.log('Primera página:', firstPage.data);

// Navegar hacia adelante
if (firstPage.pagination.hasNext) {
  const secondPage = await getModules('course-123', firstPage.pagination.nextCursor, 'asc');
  console.log('Segunda página:', secondPage.data);
}
```

## 📝 Notas Importantes

1. **Cursor encoding**: Los cursors están codificados en base64
2. **Límite fijo**: 10 módulos por página (no configurable)
3. **Ordenamiento**: Por defecto ordena por `order` ascendente
4. **Paginación unidireccional**: Solo soporta navegación hacia adelante
5. **Autenticación**: Requiere JWT token válido
6. **Permisos**: Solo muestra módulos de cursos a los que el usuario tiene acceso
7. **Índice**: Utiliza el índice `courseId-order-index` para eficiencia
