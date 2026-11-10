#!/usr/bin/env bash
# ==============================================================================
#  WOX CINEMA STUDIO PRO - Ultimate Studio Launcher
# ==============================================================================
#  Avvia l'intera suite:
#    1. Backend ComfyUI locale (:8188)
#    2. Comfy API Proxy v2 (:8189)
#    3. Wox Gateway con pantry manager e sicurezza (:8000)
#    4. Web Studio Server Node.js (:3000)
#    5. Apertura automatica dell'interfaccia nel browser
# ==============================================================================

set -eo pipefail

# Colori per il terminale
BOLD="\033[1m"
GREEN="\033[1;32m"
CYAN="\033[1;36m"
YELLOW="\033[1;33m"
RED="\033[1;31m"
DIM="\033[2m"
RESET="\033[0m"

echo -e "${CYAN}${BOLD}"
cat << "EOF"
  __        __            ____ _                          ____  _             _ _       ____  ____   ___  
  \ \      / /____  __   / ___(_)_ __   ___ _ __ ___   __ / ___|| |_ _   _  __| (_) ___ |  _ \|  _ \ / _ \ 
   \ \ /\ / / _ \ \/ /  | |   | | '_ \ / _ \ '_ ` _ \ / _` \___ \| __| | | |/ _` | |/ _ \| |_) | |_) | | | |
    \ V  V / (_) >  <   | |___| | | | |  __/ | | | | | (_| |___) | |_| |_| | (_| | | (_) |  __/|  _ <| |_| |
     \_/\_/ \___/_/\_\   \____|_|_| |_|\___|_| |_| |_|\__,_|____/ \__|\__,_|\__,_|_|\___/|_|   |_| \_\\___/ 
EOF
echo -e "${RESET}"
echo -e "${BOLD}=== Wox Cinema Studio Pro — Suite Definitiva ===${RESET}\n"

# Directory dello script e root del progetto
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# 1. Rilevamento automatico percorso ComfyUI
COMFY_CANDIDATES=(
    "${COMFY_DIR:-}"
    "/home/wox76/opt/ComfyUI"
    "$DIR/../ComfyUI"
    "$HOME/opt/ComfyUI"
    "$HOME/ComfyUI"
)

FOUND_COMFY=""
for cand in "${COMFY_CANDIDATES[@]}"; do
    if [ -n "$cand" ] && [ -d "$cand" ] && [ -f "$cand/main.py" ]; then
        FOUND_COMFY="$(cd "$cand" && pwd)"
        break
    fi
done

if [ -z "$FOUND_COMFY" ]; then
    echo -e "${RED}[ERRORE] Directory ComfyUI non trovata!${RESET}"
    echo -e "Imposta la variabile COMFY_DIR specificando il percorso, es:"
    echo -e "  export COMFY_DIR=/tuo/percorso/ComfyUI"
    exit 1
fi
COMFY_DIR="$FOUND_COMFY"
echo -e "${GREEN}✔${RESET} ComfyUI trovato in: ${BOLD}$COMFY_DIR${RESET}"

# 2. Rilevamento interprete Python (Virtualenv ComfyUI)
PYTHON_CANDIDATES=(
    "$COMFY_DIR/venv/bin/python"
    "$COMFY_DIR/.venv/bin/python"
    "$DIR/.venv/bin/python"
    "$(which python3 2>/dev/null || true)"
)

FOUND_PYTHON=""
for py in "${PYTHON_CANDIDATES[@]}"; do
    if [ -n "$py" ] && [ -x "$py" ]; then
        FOUND_PYTHON="$py"
        break
    fi
done

if [ -z "$FOUND_PYTHON" ]; then
    echo -e "${RED}[ERRORE] Interprete Python non trovato per ComfyUI!${RESET}"
    exit 1
fi
PYTHON="$FOUND_PYTHON"
echo -e "${GREEN}✔${RESET} Python ambiente:    ${BOLD}$PYTHON${RESET}"

# 3. Verifica Node.js e dipendenze
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}[ERRORE] Node.js non è installato nel sistema!${RESET}"
    exit 1
fi
NODE_VER="$(node -v)"
echo -e "${GREEN}✔${RESET} Node.js ambiente:   ${BOLD}$NODE_VER${RESET}"

if [ ! -d "$DIR/node_modules" ]; then
    echo -e "${YELLOW}➜ Installazione dipendenze Node.js in corso...${RESET}"
    npm install
fi

# 4. Configurazione .env e Token
if [ ! -f "$DIR/.env" ]; then
    if [ -f "$DIR/.env.example" ]; then
        echo -e "${YELLOW}➜ Creazione file .env da .env.example...${RESET}"
        cp "$DIR/.env.example" "$DIR/.env"
    else
        touch "$DIR/.env"
    fi
fi

# Assicura la presenza di un token e di COMFY_BASE_URL nel .env
if ! grep -q "^WOX_TOKEN=" "$DIR/.env" 2>/dev/null && ! grep -q "^FREEFIELD_TOKEN=" "$DIR/.env" 2>/dev/null; then
    GEN_TOKEN="$("$PYTHON" -c "import secrets; print(secrets.token_urlsafe(32))" 2>/dev/null || openssl rand -base64 24 | tr -d '/+=')"
    echo "WOX_TOKEN=$GEN_TOKEN" >> "$DIR/.env"
    echo "FREEFIELD_TOKEN=$GEN_TOKEN" >> "$DIR/.env"
    echo -e "${GREEN}✔${RESET} Generato nuovo token di sicurezza in .env"
elif grep -q "^FREEFIELD_TOKEN=" "$DIR/.env" && ! grep -q "^WOX_TOKEN=" "$DIR/.env"; then
    TOK_VAL="$(grep "^FREEFIELD_TOKEN=" "$DIR/.env" | cut -d= -f2-)"
    echo "WOX_TOKEN=$TOK_VAL" >> "$DIR/.env"
fi

if ! grep -q "^COMFY_BASE_URL=" "$DIR/.env" 2>/dev/null || grep -q "YOUR-WORKSPACE" "$DIR/.env" 2>/dev/null; then
    sed -i '/^COMFY_BASE_URL=/d' "$DIR/.env"
    echo "COMFY_BASE_URL=http://127.0.0.1:8000" >> "$DIR/.env"
fi

# 5. Configurazione streaming log e porte
export PYTHONUNBUFFERED=1
mkdir -p "$DIR/out"
: > "$DIR/out/terminal.log"

clean_port() {
    local port="$1"
    local pids
    pids=$(lsof -ti tcp:"$port" 2>/dev/null || true)
    if [ -n "$pids" ]; then
        echo -e "${YELLOW}➜ Chiusura processi orfani su porta :$port (PID: $pids)...${RESET}"
        kill -15 $pids 2>/dev/null || true
        sleep 0.5
        kill -9 $pids 2>/dev/null || true
    fi
}

# Funzione di arresto controllato
cleanup() {
    echo ""
    echo -e "${YELLOW}${BOLD}➜ Arresto controllato di Wox Cinema Studio Pro...${RESET}"
    trap - SIGINT SIGTERM EXIT
    kill $(jobs -p) 2>/dev/null || true
    wait 2>/dev/null || true
    echo -e "${GREEN}✔ Tutti i servizi sono stati arrestati correttamente.${RESET}"
    exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 6. Avvio del backend (ComfyUI :8188 + Proxy :8189 + Gateway :8000)
echo ""
echo -e "${CYAN}${BOLD}[1/3] Avvio Backend AI Locale (ComfyUI + Proxy + Gateway)...${RESET}"
"$PYTHON" tools/local_backend.py serve "$COMFY_DIR" "$@" &
BACKEND_PID=$!

echo -e "${DIM}➜ In attesa che il Gateway sia pronto su porta 8000...${RESET}"
TRIES=0
MAX_TRIES=120
while ! curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; do
    if ! kill -0 $BACKEND_PID 2>/dev/null; then
        echo -e "\n${RED}[ERRORE] Il backend si è interrotto improvvisamente. Controlla i log sopra.${RESET}"
        exit 1
    fi
    sleep 1
    TRIES=$((TRIES + 1))
    if [ $TRIES -ge $MAX_TRIES ]; then
        echo -e "\n${RED}[ERRORE] Timeout in attesa del backend Gateway (:8000).${RESET}"
        exit 1
    fi
done
echo -e "${GREEN}✔ Gateway attivo su http://127.0.0.1:8000${RESET}"

# 7. Avvio Frontend Web Studio (Node.js :3000)
echo ""
echo -e "${CYAN}${BOLD}[2/3] Avvio Wox Cinema Studio Pro Web Server (:3000)...${RESET}"
npm run serve 2>&1 | tee -a "$DIR/out/terminal.log" &
WEB_PID=$!

echo -e "${DIM}➜ In attesa dell'interfaccia Web su porta 3000...${RESET}"
while ! curl -s http://127.0.0.1:3000 >/dev/null 2>&1; do
    if ! kill -0 $WEB_PID 2>/dev/null; then
        echo -e "\n${RED}[ERRORE] Il server web Node.js si è interrotto.${RESET}"
        exit 1
    fi
    sleep 0.5
done
echo -e "${GREEN}✔ Web Studio pronto su http://127.0.0.1:3000${RESET}"

# 8. Apertura Browser
TARGET_URL="http://127.0.0.1:3000/#/app/cinema-studio"
echo ""
echo -e "${CYAN}${BOLD}[3/3] Apertura interfaccia grafica...${RESET}"
if [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$TARGET_URL" >/dev/null 2>&1 || true
        echo -e "${GREEN}✔ Browser aperto su: ${BOLD}$TARGET_URL${RESET}"
    fi
else
    echo -e "${YELLOW}➜ Modalità headless (senza display grafico). Collegati da remoto a:${RESET}"
    echo -e "   ${BOLD}$TARGET_URL${RESET}"
fi

echo ""
echo -e "${GREEN}${BOLD}========================================================================${RESET}"
echo -e "${GREEN}${BOLD}    WOX CINEMA STUDIO PRO È OPERATIVO E PRONTO!                         ${RESET}"
echo -e "    Studio UI:     ${BOLD}http://127.0.0.1:3000${RESET}"
echo -e "    Video Studio:  ${BOLD}http://127.0.0.1:3000/editor/${RESET}"
echo -e "    ComfyUI:       ${BOLD}http://127.0.0.1:8188${RESET}"
echo -e "    Gateway API:   ${BOLD}http://127.0.0.1:8000${RESET}"
echo -e "${GREEN}${BOLD}========================================================================${RESET}"
echo -e "${DIM}Premi [CTRL+C] in questa finestra per arrestare tutti i servizi.${RESET}\n"

# Mantieni il processo in ascolto attendendo i job in background
wait
