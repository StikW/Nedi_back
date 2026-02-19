# Módulo de Uploads

Este módulo maneja la subida de archivos a AWS S3 de forma segura utilizando pre-signed URLs.

## Características

- ✅ Generación de pre-signed URLs para upload
- ✅ Generación de pre-signed URLs para download
- ✅ Organización de archivos por curso
- ✅ Validación de tipos MIME
- ✅ Autenticación JWT requerida
- ✅ URLs temporales (15 min para upload, 60s para download)

## Endpoints

### 1. Generar URL de Upload (Original - Imágenes de Curso)
```http
POST /uploads/presigned-url
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "courseId": "course-uuid",
  "filename": "course-image.jpg",
  "contentType": "image/jpeg"
}
```

**Respuesta:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/course-bucket/courses/course-uuid/1234567890-course-image.jpg?...",
  "fileKey": "courses/course-uuid/1234567890-course-image.jpg"
}
```

### 2. Generar URL de Upload para Imágenes de Curso (Alias)
```http
POST /uploads/course/presigned-url
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "courseId": "course-uuid",
  "filename": "course-image.jpg",
  "contentType": "image/jpeg"
}
```

**Respuesta:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/course-bucket/courses/course-uuid/1234567890-course-image.jpg?...",
  "fileKey": "courses/course-uuid/1234567890-course-image.jpg"
}
```

### 3. Generar URL de Upload para Recursos de Módulos
```http
POST /uploads/module/presigned-url
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "courseId": "course-uuid",
  "moduleId": "module-uuid",
  "filename": "document.pdf",
  "contentType": "application/pdf"
}
```

**Respuesta:**
```json
{
  "uploadUrl": "https://s3.amazonaws.com/modules-bucket/courses/course-uuid/modules/module-uuid/1234567890-document.pdf?...",
  "fileKey": "courses/course-uuid/modules/module-uuid/1234567890-document.pdf"
}
```

### 3. Generar URL de Download (Original - Archivos de Curso)
```http
GET /uploads/:courseId/:fileKey
Authorization: Bearer <jwt_token>
```

**Respuesta:**
```json
{
  "downloadUrl": "https://s3.amazonaws.com/course-bucket/courses/course-uuid/1234567890-course-image.jpg?..."
}
```

### 4. Generar URL de Download para Archivos de Curso (Alias)
```http
GET /uploads/course/:courseId/:fileKey
Authorization: Bearer <jwt_token>
```

**Respuesta:**
```json
{
  "downloadUrl": "https://s3.amazonaws.com/course-bucket/courses/course-uuid/1234567890-course-image.jpg?..."
}
```

### 5. Generar URL de Download para Recursos de Módulos
```http
GET /uploads/module/:courseId/:moduleId/:fileKey
Authorization: Bearer <jwt_token>
```

**Respuesta:**
```json
{
  "downloadUrl": "https://s3.amazonaws.com/modules-bucket/courses/course-uuid/modules/module-uuid/1234567890-document.pdf?..."
}
```

## Flujo de Uso

1. **Frontend solicita URL de upload:**
   ```javascript
   const response = await fetch('/uploads/presigned-url', {
     method: 'POST',
     headers: {
       'Authorization': `Bearer ${token}`,
       'Content-Type': 'application/json'
     },
     body: JSON.stringify({
       courseId: 'course-uuid',
       filename: 'video.mp4',
       contentType: 'video/mp4'
     })
   });
   
   const { uploadUrl, fileKey } = await response.json();
   ```

2. **Frontend sube archivo directamente a S3:**
   ```javascript
   await fetch(uploadUrl, {
     method: 'PUT',
     body: file,
     headers: {
       'Content-Type': 'video/mp4'
     }
   });
   ```

3. **Frontend guarda fileKey en la base de datos** para referencia futura

4. **Para descargar, solicita URL de download:**
   ```javascript
   const response = await fetch(`/uploads/${courseId}/${fileKey}`, {
     headers: {
       'Authorization': `Bearer ${token}`
     }
   });
   
   const { downloadUrl } = await response.json();
   window.open(downloadUrl);
   ```

## Estructura de Archivos en S3

### Bucket de Cursos (S3_BUCKET)
```
course-bucket/
└── courses/
    └── course-uuid/
        ├── 1234567890-course-image.jpg
        ├── 1234567891-thumbnail.png
        └── 1234567892-banner.webp
```

### Bucket de Módulos (S3_BUCKET_MODULES)
```
modules-bucket/
└── courses/
    └── course-uuid/
        └── modules/
            └── module-uuid/
                ├── 1234567890-document.pdf
                ├── 1234567891-video.mp4
                ├── 1234567892-presentation.pptx
                └── 1234567893-exercise.zip
```

## Seguridad

- ✅ URLs temporales con expiración
- ✅ Validación de tipos MIME
- ✅ Autenticación JWT requerida
- ✅ Validación de pertenencia al curso
- ✅ Nombres de archivo únicos con timestamp

## Variables de Entorno Requeridas

```bash
AWS_REGION=us-east-1
S3_BUCKET=your-course-bucket-name
S3_BUCKET_MODULES=your-modules-bucket-name
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```
