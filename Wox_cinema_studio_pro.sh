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

# 1. Verifica Node.js e dipendenze (servono sia per l'avvio completo sia per la modalità Setup/Auto-Installer)
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

# 2. Rilevamento automatico percorso ComfyUI (incluso out/settings.json)
SETTINGS_COMFY="$(node -e "try{const fs=require('fs'),p=require('path').join(process.cwd(),'out','settings.json');if(fs.existsSync(p)){const d=JSON.parse(fs.readFileSync(p,'utf8'));const v=d.comfyDir||d.comfy_dir;if(v)process.stdout.write(String(v));}}catch{}" 2>/dev/null || true)"
COMFY_CANDIDATES=(
    "${COMFY_DIR:-}"
    "$SETTINGS_COMFY"
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

# 3. Rilevamento interprete Python (Virtualenv ComfyUI o sistema)
PYTHON_CANDIDATES=()
if [ -n "$FOUND_COMFY" ]; then
    PYTHON_CANDIDATES+=(
        "$FOUND_COMFY/venv/bin/python"
        "$FOUND_COMFY/.venv/bin/python"
    )
fi
PYTHON_CANDIDATES+=(
    "$DIR/.venv/bin/python"
    "$(command -v python3 2>/dev/null || true)"
)

FOUND_PYTHON=""
for py in "${PYTHON_CANDIDATES[@]}"; do
    if [ -n "$py" ] && [ -x "$py" ]; then
        FOUND_PYTHON="$py"
        break
    fi
done

# 4. Configurazione .env e Token (cross-platform, senza sed -i)
node -e '
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const envPath = path.join(process.cwd(), ".env");
const exPath = path.join(process.cwd(), ".env.example");
if (!fs.existsSync(envPath)) {
  if (fs.existsSync(exPath)) fs.copyFileSync(exPath, envPath);
  else fs.writeFileSync(envPath, "", "utf8");
}
let text = fs.readFileSync(envPath, "utf8").replace(/\r\n/g, "\n");
const lines = text.split("\n");
const getVal = (k) => {
  const l = lines.find((x) => x.startsWith(k + "="));
  return l ? l.slice(k.length + 1).trim() : "";
};
let woxTok = getVal("WOX_TOKEN");
let ffTok = getVal("FREEFIELD_TOKEN");
if (!woxTok && !ffTok) {
  const gen = crypto.randomBytes(24).toString("base64url");
  woxTok = gen; ffTok = gen;
  lines.push("WOX_TOKEN=" + gen, "FREEFIELD_TOKEN=" + gen);
  console.log("NEW_TOKEN");
} else if (ffTok && !woxTok) {
  lines.push("WOX_TOKEN=" + ffTok);
}
const curBase = getVal("COMFY_BASE_URL");
if (!curBase || curBase.includes("YOUR-WORKSPACE")) {
  const filtered = lines.filter((x) => !x.startsWith("COMFY_BASE_URL="));
  filtered.push("COMFY_BASE_URL=http://127.0.0.1:8000");
  text = filtered.filter((x, i, a) => i < a.length - 1 || x !== "").join("\n") + "\n";
} else {
  text = lines.filter((x, i, a) => i < a.length - 1 || x !== "").join("\n") + "\n";
}
fs.writeFileSync(envPath, text, "utf8");
'

# 5. Configurazione streaming log
export PYTHONUNBUFFERED=1
mkdir -p "$DIR/out"
: > "$DIR/out/terminal.log"

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

# Verifica se ComfyUI + comfy-api-proxy sono pronti; altrimenti avvia in modalità Auto-Installer Web
HAS_PROXY=0
if [ -n "$FOUND_PYTHON" ]; then
    PY_DIR="$(dirname "$FOUND_PYTHON")"
    if [ -x "$PY_DIR/comfy-api-proxy" ] || command -v comfy-api-proxy >/dev/null 2>&1; then
        HAS_PROXY=1
    fi
fi

if [ -n "$FOUND_COMFY" ] && [ -n "$FOUND_PYTHON" ] && [ "$HAS_PROXY" -eq 1 ]; then
    COMFY_DIR="$FOUND_COMFY"
    PYTHON="$FOUND_PYTHON"
    echo -e "${GREEN}✔${RESET} ComfyUI trovato in: ${BOLD}$COMFY_DIR${RESET}"
    echo -e "${GREEN}✔${RESET} Python ambiente:    ${BOLD}$PYTHON${RESET}"

    # 6. Avvio del backend (ComfyUI :8188 + Proxy :8189 + Gateway :8000)
    echo ""
    echo -e "${CYAN}${BOLD}[1/3] Avvio Backend AI Locale (ComfyUI + Proxy + Gateway)...${RESET}"
    "$PYTHON" tools/local_backend.py serve "$COMFY_DIR" "$@" &
    BACKEND_PID=$!

    echo -e "${DIM}➜ In attesa che il Gateway sia pronto su porta 8000...${RESET}"
    TRIES=0
    MAX_TRIES=120
    while ! node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
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
else
    echo -e "${YELLOW}[INFO] ComfyUI o comfy-api-proxy non ancora installati.${RESET}"
    echo -e "${YELLOW}➜ Avvio in modalità Setup / Auto-Installer: apri ⚙️ -> Auto-Installer nell'UI Web!${RESET}"
fi

# 7. Avvio Frontend Web Studio (Node.js :3000)
echo ""
echo -e "${CYAN}${BOLD}[2/3] Avvio Wox Cinema Studio Pro Web Server (:3000)...${RESET}"
npm run serve 2>&1 | tee -a "$DIR/out/terminal.log" &
WEB_PID=$!

echo -e "${DIM}➜ In attesa dell'interfaccia Web su porta 3000...${RESET}"
while ! node -e "fetch('http://127.0.0.1:3000').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
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
