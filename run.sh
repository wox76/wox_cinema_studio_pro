#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMFY_DIR="/home/wox76/opt/ComfyUI"
PYTHON="$COMFY_DIR/venv/bin/python"

echo "=== Avvio di Wox Cinema Studio Pro e ComfyUI Backend ==="

cleanup() {
    echo ""
    echo "Arresto dei servizi..."
    kill $(jobs -p) 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Tutti i servizi arrestati."
}
trap cleanup SIGINT SIGTERM EXIT

cd "$DIR"

export PYTHONUNBUFFERED=1
mkdir -p "$DIR/out"

# 1. Avvio del backend (ComfyUI :8188 + Proxy :8189 + Gateway :8000)
echo "-> Avvio Backend locale (ComfyUI + Proxy + Gateway)..."
"$PYTHON" tools/local_backend.py serve "$COMFY_DIR" "$@" &
BACKEND_PID=$!

# Attesa che il gateway sia pronto su :8000
echo "-> In attesa del gateway su porta 8000..."
while ! curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; do
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        echo "Errore: il backend si è interrotto."
        exit 1
    fi
    sleep 1
done
echo "-> Gateway attivo su http://127.0.0.1:8000"

# 2. Avvio del frontend web (Node.js su :3000)
echo "-> Avvio Wox Cinema Studio Pro Web Studio su http://127.0.0.1:3000/#/app/cinema-studio ..."
(
    while ! curl -s http://127.0.0.1:3000 >/dev/null 2>&1; do
        sleep 0.5
    done
    if [ -n "$DISPLAY" ] && command -v xdg-open >/dev/null 2>&1; then
        xdg-open "http://127.0.0.1:3000/#/app/cinema-studio" >/dev/null 2>&1 || true
    fi
) &

npm run serve 2>&1 | tee -a "$DIR/out/terminal.log"
