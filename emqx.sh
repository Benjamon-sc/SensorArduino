#!/usr/bin/env bash
# Helper para gestionar el contenedor EMQX con Podman o Docker

CONTAINER_NAME="emqx_broker"

if command -v podman >/dev/null 2>&1; then
    ENGINE="podman"
elif command -v docker >/dev/null 2>&1; then
    ENGINE="docker"
else
    echo "❌ Error: Ni podman ni docker están instalados en el sistema."
    exit 1
fi

case "$1" in
    start)
        echo "🚀 Iniciando EMQX usando $ENGINE..."
        if $ENGINE ps -a --format '{{.Names}}' | grep -Eq "^${CONTAINER_NAME}\$"; then
            $ENGINE start "$CONTAINER_NAME"
        else
            $ENGINE run -d --name "$CONTAINER_NAME" \
                -p 1883:1883 \
                -p 8083:8083 \
                -p 18083:18083 \
                -v emqx_data:/opt/emqx/data:Z \
                -v emqx_log:/opt/emqx/log:Z \
                docker.io/emqx/emqx:5.8.0
        fi
        echo "✅ EMQX iniciado con éxito."
        echo "   MQTT Broker:     puerto 1883"
        echo "   WebSockets MQTT: puerto 8083"
        echo "   Dashboard Web:   http://localhost:18083 (admin / public)"
        ;;
    stop)
        echo "🛑 Deteniendo EMQX..."
        $ENGINE stop "$CONTAINER_NAME"
        ;;
    status)
        $ENGINE ps --filter "name=$CONTAINER_NAME"
        ;;
    logs)
        $ENGINE logs -f "$CONTAINER_NAME"
        ;;
    *)
        echo "Uso: $0 {start|stop|status|logs}"
        exit 1
        ;;
esac
