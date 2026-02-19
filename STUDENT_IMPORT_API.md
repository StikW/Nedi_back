# API de Importación de Estudiantes desde CSV

## Endpoint: POST /students/course/{courseId}/import

Este endpoint permite importar estudiantes masivamente desde un archivo CSV.

### Autenticación
- **Requerida**: Sí (JWT Token)
- **Permisos**: Solo instructores propietarios del curso

### Parámetros de URL
- `courseId` (string, requerido): ID del curso al que se importarán los estudiantes

### Body (multipart/form-data)
- `file` (archivo, requerido): Archivo CSV con los datos de los estudiantes

### Formato del CSV
El archivo CSV debe tener las siguientes columnas:
```csv
name,phonenumber
Juan Pérez,+1234567890
María García,+0987654321
Carlos López,+1122334455
```

**Columnas requeridas:**
- `name`: Nombre completo del estudiante
- `phonenumber`: Número de teléfono (puede incluir el prefijo +)

### Validaciones
- **Tamaño máximo**: 5MB
- **Formato**: Solo archivos CSV
- **Teléfonos**: Formato internacional válido (+1234567890)
- **Duplicados**: Se verifica que no exista otro estudiante con el mismo teléfono en el curso
- **Permisos**: Solo el instructor propietario del curso puede importar estudiantes

### Respuesta Exitosa (200)
```json
{
  "success": 2,
  "failed": 1,
  "errors": [
    {
      "row": 3,
      "name": "Carlos López",
      "phoneNumber": "+1122334455",
      "error": "Ya existe un estudiante con este número de teléfono en el curso"
    }
  ],
  "createdStudents": [
    {
      "id": "uuid-1",
      "name": "Juan Pérez",
      "phoneNumber": "1234567890",
      "courseId": "course-uuid",
      "instructorId": "instructor-uuid",
      "enrolledAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    },
    {
      "id": "uuid-2",
      "name": "María García",
      "phoneNumber": "0987654321",
      "courseId": "course-uuid",
      "instructorId": "instructor-uuid",
      "enrolledAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ]
}
```

### Campos de Respuesta
- `success` (number): Número de estudiantes creados exitosamente
- `failed` (number): Número de estudiantes que fallaron al crear
- `errors` (array): Lista de errores con detalles:
  - `row` (number): Número de fila en el CSV
  - `name` (string): Nombre del estudiante
  - `phoneNumber` (string): Número de teléfono
  - `error` (string): Descripción del error
- `createdStudents` (array): Lista de estudiantes creados exitosamente

### Errores Posibles

#### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": "No se proporcionó ningún archivo"
}
```

```json
{
  "statusCode": 400,
  "message": "El archivo debe ser un CSV válido"
}
```

```json
{
  "statusCode": 400,
  "message": "El archivo es demasiado grande. Máximo 5MB"
}
```

#### 403 Forbidden
```json
{
  "statusCode": 403,
  "message": "Curso no encontrado o no tienes permisos para agregar estudiantes a este curso"
}
```

#### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### Ejemplo de Uso con cURL
```bash
curl -X POST \
  http://localhost:3000/students/course/course-uuid/import \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@students.csv"
```

### Ejemplo de Uso con Postman
1. **Método**: POST
2. **URL**: `http://localhost:3000/students/course/{courseId}/import`
3. **Headers**:
   - `Authorization`: `Bearer YOUR_JWT_TOKEN`
4. **Body**:
   - Seleccionar `form-data`
   - Agregar campo `file` de tipo `File`
   - Seleccionar el archivo CSV

### Notas Importantes
- Los números de teléfono se normalizan automáticamente (se remueve el símbolo +)
- Se procesan en lotes de 25 estudiantes para optimizar el rendimiento
- Si un estudiante ya existe en el curso, se marca como fallido pero no interrumpe el proceso
- El endpoint es idempotente: ejecutar múltiples veces con el mismo CSV no creará duplicados
- Se recomienda revisar los errores en la respuesta para corregir datos inválidos

### Límites
- **Tamaño máximo del archivo**: 5MB
- **Lote de procesamiento**: 25 estudiantes por lote
- **Formato de teléfono**: Debe ser un número internacional válido
