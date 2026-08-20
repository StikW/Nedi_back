#!/usr/bin/env bash
# Reinicia el backend Nest en el servidor (PM2).
# Compila dist/ y arranca con node dist/main (produccion).
# Uso: ./scripts/deploy-pm2.sh [nombre-proceso-pm2]

set -euo pipefail

APP_NAME="${1:-ia-learning-backend}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"

echo "==> Instalando dependencias..."
npm install

echo "==> Compilando (dist/main.js)..."
rm -rf dist tsconfig.tsbuildinfo
npm run build

if [ ! -f dist/main.js ]; then
  echo "ERROR: dist/main.js no existe tras el build. Revisa errores de TypeScript arriba."
  exit 1
fi

if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  echo "==> Reiniciando PM2: $APP_NAME"
  pm2 restart "$APP_NAME" --update-env
else
  echo "==> Iniciando PM2: $APP_NAME"
  pm2 start npm --name "$APP_NAME" --cwd "$ROOT" -- run start:prod
fi

pm2 save

echo "==> Probando health local..."
sleep 2
curl -sf "http://127.0.0.1:3000/health" | head -c 200
echo ""
echo "Listo. Verifica: curl https://tututor.co/api/health"
