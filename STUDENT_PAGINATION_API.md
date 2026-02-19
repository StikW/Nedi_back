# 👥 API de Paginación de Estudiantes

## 🎯 Endpoint

```
GET /students/course/:courseId
```

**Nota**: El mismo endpoint maneja tanto la respuesta completa como la paginada según los parámetros proporcionados.

## 📋 Parámetros de Query

| Parámetro | Tipo | Requerido | Default | Descripción |
|-----------|------|-----------|---------|-------------|
| `cursor` | string | No | - | Cursor para la siguiente página |
| `sortOrder` | string | No | asc | Orden: 'asc' o 'desc' |

**Nota**: El límite está fijo en 10 estudiantes por página.

## 🔧 Ejemplos de Uso

### Obtener todos los estudiantes (comportamiento original)
```bash
GET /students/course/course-123
```

### Primera página con paginación
```bash
GET /students/course/course-123?sortOrder=asc
```

### Siguiente página
```bash
GET /students/course/course-123?cursor=eyJpZCI6InN0dWRlbnQtMTIzIn0=&sortOrder=asc
```

### Con orden descendente
```bash
GET /students/course/course-123?sortOrder=desc
```

## 📊 Respuesta

### Sin parámetros de paginación (comportamiento original)
```json
[
  {
    "id": "student-123",
    "courseId": "course-456",
    "firstName": "Juan",
    "lastName": "Pérez",
    "email": "juan.perez@email.com",
    "phoneNumber": "+1234567890",
    "enrollmentDate": "2024-01-15T10:30:00.000Z",
    "status": "active",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  },
  {
    "id": "student-124",
    "courseId": "course-456",
    "firstName": "María",
    "lastName": "García",
    "email": "maria.garcia@email.com",
    "phoneNumber": "+1234567891",
    "enrollmentDate": "2024-01-16T09:15:00.000Z",
    "status": "active",
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
      "id": "student-123",
      "courseId": "course-456",
      "firstName": "Juan",
      "lastName": "Pérez",
      "email": "juan.perez@email.com",
      "phoneNumber": "+1234567890",
      "enrollmentDate": "2024-01-15T10:30:00.000Z",
      "status": "active",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "pagination": {
    "limit": 10,
    "hasNext": true,
    "nextCursor": "eyJpZCI6InN0dWRlbnQtMTIzIn0=",
    "sortOrder": "asc"
  }
}
```

## 🔄 Flujo de Paginación

1. **Primera página**: `GET /students/course/:courseId?sortOrder=asc`
2. **Siguiente página**: Usar `nextCursor` de la respuesta anterior
3. **Continuar**: Repetir hasta que `hasNext` sea `false`

## ✅ Ventajas de la Paginación

- ✅ **Performance**: Solo carga 10 estudiantes por vez
- ✅ **Escalabilidad**: Funciona con cursos que tienen muchos estudiantes
- ✅ **Consistencia**: Mismo patrón que la paginación de cursos y módulos
- ✅ **Flexibilidad**: Soporta ordenamiento ascendente y descendente
- ✅ **Validación**: Verifica permisos de acceso al curso

## ❌ Limitaciones

- ❌ **No salto a página específica**: Solo secuencial
- ❌ **No conteo total**: No se proporciona el número total de estudiantes

## 🔧 Implementación en Frontend

```javascript
// Función para obtener estudiantes (con o sin paginación)
async function getStudents(courseId, cursor = null, sortOrder = null) {
  const params = new URLSearchParams();
  
  if (cursor) params.append('cursor', cursor);
  if (sortOrder) params.append('sortOrder', sortOrder);
  
  const response = await fetch(`/students/course/${courseId}?${params}`);
  return await response.json();
}

// Ejemplos de uso

// Obtener todos los estudiantes (comportamiento original)
const allStudents = await getStudents('course-123');
console.log('Todos los estudiantes:', allStudents);

// Obtener primera página con paginación
const firstPage = await getStudents('course-123', null, 'asc');
console.log('Primera página:', firstPage.data);

// Navegar hacia adelante
if (firstPage.pagination.hasNext) {
  const secondPage = await getStudents('course-123', firstPage.pagination.nextCursor, 'asc');
  console.log('Segunda página:', secondPage.data);
}
```

## 🔍 Casos de Uso Comunes

### Lista de estudiantes con paginación
```javascript
async function loadStudentsList(courseId, page = 1) {
  let students = [];
  let currentCursor = null;
  let currentPage = 1;
  
  do {
    const response = await getStudents(courseId, currentCursor, 'asc');
    students = [...students, ...response.data];
    currentCursor = response.pagination.nextCursor;
    currentPage++;
  } while (response.pagination.hasNext && currentPage <= page);
  
  return students;
}
```

### Búsqueda de estudiantes específicos
```javascript
async function searchStudents(courseId, searchTerm) {
  const allStudents = await getStudents(courseId); // Sin paginación para búsqueda completa
  
  return allStudents.filter(student => 
    student.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    student.email.toLowerCase().includes(searchTerm.toLowerCase())
  );
}
```

## 📝 Notas Importantes

1. **Cursor encoding**: Los cursors están codificados en base64
2. **Límite fijo**: 10 estudiantes por página (no configurable)
3. **Ordenamiento**: Por defecto ordena por `id` ascendente
4. **Paginación unidireccional**: Solo soporta navegación hacia adelante
5. **Autenticación**: Requiere JWT token válido
6. **Permisos**: Solo muestra estudiantes de cursos a los que el instructor tiene acceso
7. **Índice**: Utiliza el índice `courseId-index` para eficiencia
8. **Validación**: Verifica que el curso existe y pertenece al instructor antes de mostrar estudiantes

## 🚨 Manejo de Errores

### Curso no encontrado o sin permisos
```json
{
  "statusCode": 403,
  "message": "Curso no encontrado o no tienes permisos para ver los estudiantes de este curso",
  "error": "Forbidden"
}
```

### Error interno del servidor
```json
{
  "statusCode": 500,
  "message": "Error al obtener los estudiantes del curso",
  "error": "Internal Server Error"
}
```

## 🔄 Comparación con otros endpoints

| Endpoint | Límite | Índice | Orden por defecto |
|----------|--------|--------|-------------------|
| `/courses` | 10 | `instructorId-index` | `desc` (createdAt) |
| `/courses/:id/modules` | 10 | `courseId-order-index` | `asc` (order) |
| `/students/course/:id` | 10 | `courseId-index` | `asc` (id) |
