# Usa una imagen oficial de Node.js como base
FROM node:18-alpine

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala las dependencias
RUN npm ci --only=production && npm cache clean --force

# Copia el código fuente
COPY . .

# Compila la aplicación TypeScript
RUN npm run build

# Crea un usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nestjs -u 1001

# Cambia la propiedad de los archivos al usuario nestjs
RUN chown -R nestjs:nodejs /app
USER nestjs

# Expone el puerto
EXPOSE 3000

# Comando para iniciar la app
CMD ["node", "dist/main.js"]