#!/usr/bin/env bash

# Script para iniciar backend y frontend simultáneamente

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

echo "🌱 Iniciando ESP32 Sensor Dashboard..."

# Configurar IP del ESP32 (por argumento o por defecto a la IP detectada en la red)
RAW_IP="${1:-192.168.1.58}"
export ESP32_IP=$(echo "$RAW_IP" | sed -e 's|^https*://||' -e 's|/*$||')
echo "📡 IP del ESP32 configurada: $ESP32_IP"

# 1. Iniciar backend
echo "🚀 Iniciando Backend (Node.js en puerto 3000)..."
cd "$DIR/dashboard" && npm start &
BACKEND_PID=$!

# Esperar 2 segundos para que el backend esté listo
sleep 2

# 2. Iniciar frontend
echo "🎨 Iniciando Frontend (Angular en puerto 4200)..."
cd "$DIR/dashboard-app" && npm start &
FRONTEND_PID=$!

# Manejar cierre limpio con Ctrl+C
cleanup() {
  echo -e "\n🛑 Deteniendo servicios..."
  kill $BACKEND_PID 2>/dev/null
  kill $FRONTEND_PID 2>/dev/null
  exit 0
}

trap cleanup INT TERM

echo ""
echo "=================================================="
echo "  ✅ Dashboard corriendo:"
echo "     Frontend: http://localhost:4200"
echo "     Backend:  http://localhost:3000"
echo "  Presiona Ctrl+C para detener ambos servidores."
echo "=================================================="
echo ""

wait
