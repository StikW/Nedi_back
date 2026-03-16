# Variables de Entorno Requeridas

## AWS Configuration
```bash
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id
AWS_SECRET_ACCESS_KEY=your_secret_access_key
```

## S3 Configuration
```bash
S3_BUCKET=your-s3-bucket-name
S3_BUCKET_MODULES=your-s3-bucket-modules-name
```

## JWT Configuration
```bash
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h
```

## Database Configuration (DynamoDB)
```bash
# Opcional. Prefijo para nombres de tablas (ej. dev_ → dev_Users, dev_Courses).
# Déjalo vacío o no lo definas para usar tablas sin prefijo (Users, Courses, ...).
DYNAMODB_TABLE_PREFIX=dev_
```

Para crear las tablas en una cuenta AWS nueva, usa el script `scripts/create-dynamodb-tables.js` y configura las mismas variables `AWS_*` y opcionalmente `DYNAMODB_TABLE_PREFIX`. Ver **DYNAMODB_TABLES.md** para el listado de tablas y esquemas.

## Configuración del Bucket S3

Para que el módulo de uploads funcione correctamente, necesitas:

1. **Crear un bucket S3** en la región especificada
2. **Configurar los permisos** del bucket para permitir operaciones de lectura/escritura
3. **Configurar CORS** si planeas subir archivos desde el frontend

### Ejemplo de configuración CORS para S3:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": []
  }
]
```

### Política de bucket para acceso público a imágenes:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/courses/*/*.jpg",
      "Condition": {
        "StringEquals": {
          "s3:ResourceType": "object"
        }
      }
    },
    {
      "Sid": "PublicReadForImagesPNG",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/courses/*/*.png",
      "Condition": {
        "StringEquals": {
          "s3:ResourceType": "object"
        }
      }
    },
    {
      "Sid": "PublicReadForImagesWebP",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/courses/*/*.webp",
      "Condition": {
        "StringEquals": {
          "s3:ResourceType": "object"
        }
      }
    },
    {
      "Sid": "AllowUploadsForAuthenticatedUsers",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/YOUR_IAM_USER"
      },
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

### Configuración alternativa más restrictiva (solo imágenes específicas):
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadForCourseImages",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME/courses/*/course-image.*",
        "arn:aws:s3:::YOUR_BUCKET_NAME/courses/*/thumbnail.*"
      ],
      "Condition": {
        "StringLike": {
          "s3:ResourceType": "object"
        }
      }
    },
    {
      "Sid": "AllowUploadsForAuthenticatedUsers",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::YOUR_ACCOUNT_ID:user/YOUR_IAM_USER"
      },
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

## ⚠️ Consideraciones Importantes para Acceso Público

### 1. **Configuración del Bucket**
- **Deshabilitar "Block Public Access"** en la configuración del bucket
- **Habilitar "ACLs"** si planeas usar ACLs específicos
- **Configurar CORS** para permitir acceso desde tu frontend

### 2. **Estructura de Archivos Recomendada**
```
bucket/
└── courses/
    └── course-uuid/
        ├── course-image.jpg      # ← Público
        ├── thumbnail.png         # ← Público
        ├── video.mp4            # ← Privado (pre-signed URLs)
        └── document.pdf          # ← Privado (pre-signed URLs)
```

### 3. **URLs Públicas para Imágenes**
Una vez configurado, las imágenes serán accesibles directamente:
```
https://YOUR_BUCKET_NAME.s3.AWS_REGION.amazonaws.com/courses/course-uuid/course-image.jpg
```

### 4. **Seguridad**
- ✅ **Solo imágenes** son públicas
- ✅ **Videos y documentos** siguen siendo privados
- ✅ **Uploads** requieren autenticación
- ✅ **Estructura organizada** por curso

### 5. **Configuración CORS Actualizada**
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["https://yourdomain.com", "http://localhost:3000"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```
