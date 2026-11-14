@echo off
setlocal EnableExtensions DisableDelayedExpansion
chcp 65001 >nul 2>&1

set "DIR=%~dp0"
if "%DIR:~-1%"=="\" set "DIR=%DIR:~0,-1%"
cd /d "%DIR%"

echo.
echo ========================================================================
echo    WOX CINEMA STUDIO PRO - Avvio Sistema AI Locale (Windows)
echo ========================================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non e' installato nel sistema!
    echo Scarica Node.js LTS da https://nodejs.org/ e riprova.
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
echo [OK] Node.js ambiente: %NODE_VER%

if not exist "%DIR%\node_modules" (
    echo [INFO] Installazione dipendenze Node.js in corso...
    call npm install
    if errorlevel 1 (
        echo [ERRORE] npm install fallito.
        pause
        exit /b 1
    )
)

rem Configurazione .env e Token (cross-platform via Node.js)
node -e "const fs=require('fs'),path=require('path'),crypto=require('crypto');const envPath=path.join(process.cwd(),'.env'),exPath=path.join(process.cwd(),'.env.example');if(!fs.existsSync(envPath)){if(fs.existsSync(exPath))fs.copyFileSync(exPath,envPath);else fs.writeFileSync(envPath,'','utf8');}let lines=fs.readFileSync(envPath,'utf8').replace(/\r\n/g,'\n').split('\n');const getVal=k=>{const l=lines.find(x=>x.startsWith(k+'='));return l?l.slice(k.length+1).trim():'';};let wox=getVal('WOX_TOKEN'),ff=getVal('FREEFIELD_TOKEN');if(!wox&&!ff){const g=crypto.randomBytes(24).toString('base64url');lines.push('WOX_TOKEN='+g,'FREEFIELD_TOKEN='+g);}else if(ff&&!wox){lines.push('WOX_TOKEN='+ff);}const base=getVal('COMFY_BASE_URL');if(!base||base.includes('YOUR-WORKSPACE')){lines=lines.filter(x=>!x.startsWith('COMFY_BASE_URL='));lines.push('COMFY_BASE_URL=http://127.0.0.1:8000');}fs.writeFileSync(envPath,lines.filter((x,i,a)=>i<a.length-1||x!=='').join('\n')+'\n','utf8');"

set "SETTINGS_COMFY="
for /f "delims=" %%c in ('node -e "try{const fs=require('fs'),p=require('path').join(process.cwd(),'out','settings.json');if(fs.existsSync(p)){const d=JSON.parse(fs.readFileSync(p,'utf8'));const v=d.comfyDir||d.comfy_dir;if(v)process.stdout.write(String(v));}}catch{}" 2^>nul') do set "SETTINGS_COMFY=%%c"

set "FOUND_COMFY="
call :check_comfy "%COMFY_DIR%"
call :check_comfy "%SETTINGS_COMFY%"
call :check_comfy "%DIR%\..\ComfyUI"
call :check_comfy "%USERPROFILE%\opt\ComfyUI"
call :check_comfy "%USERPROFILE%\ComfyUI"
call :check_comfy "C:\ComfyUI"
call :check_comfy "%USERPROFILE%\ComfyUI_windows_portable\ComfyUI"
call :check_comfy "%DIR%\..\ComfyUI_windows_portable\ComfyUI"
call :check_comfy "%LOCALAPPDATA%\ComfyUI"

set "FOUND_PYTHON="
if defined FOUND_COMFY (
    call :check_py "%FOUND_COMFY%\venv\Scripts\python.exe"
    call :check_py "%FOUND_COMFY%\.venv\Scripts\python.exe"
    call :check_py "%FOUND_COMFY%\..\python_embeded\python.exe"
    call :check_py "%FOUND_COMFY%\..\python_embedded\python.exe"
    call :check_py "%FOUND_COMFY%\python_embeded\python.exe"
    call :check_py "%FOUND_COMFY%\python_embedded\python.exe"
)
call :check_py "%DIR%\.venv\Scripts\python.exe"
if not defined FOUND_PYTHON (
    for /f "delims=" %%p in ('where python 2^>nul') do call :check_py "%%p"
)

set "HAS_PROXY=0"
if defined FOUND_PYTHON (
    for %%F in ("%FOUND_PYTHON%") do set "PY_DIR=%%~dpF"
    call :check_proxy
)

set "PYTHONUNBUFFERED=1"
set "PYTHONIOENCODING=utf-8"
set "PYTHONUTF8=1"
if not exist "%DIR%\out" mkdir "%DIR%\out"
type nul > "%DIR%\out\terminal.log"

if defined FOUND_COMFY if defined FOUND_PYTHON if "%HAS_PROXY%"=="1" goto :full_start

echo [INFO] ComfyUI o comfy-api-proxy non ancora installati.
echo [INFO] Avvio in modalita' Setup / Auto-Installer: apri l'icona ingranaggio -^> Auto-Installer nell'UI Web!
goto :start_web

:full_start
echo [OK] ComfyUI trovato in: %FOUND_COMFY%
echo [OK] Python ambiente:    %FOUND_PYTHON%
echo.
echo [1/3] Avvio Backend AI Locale (ComfyUI + Proxy + Gateway)...
start "Wox AI Backend" cmd /c ""%FOUND_PYTHON%" tools\local_backend.py serve "%FOUND_COMFY%" %*"

echo [INFO] In attesa che il Gateway sia pronto su porta 8000...
set /a TRIES=0
:wait_gateway
node -e "fetch('http://127.0.0.1:8000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >nul 2>&1
if not errorlevel 1 goto :gateway_ready
set /a TRIES+=1
if %TRIES% GEQ 120 (
    echo [ERRORE] Timeout in attesa del backend Gateway ^(:8000^).
    goto :start_web
)
ping -n 2 127.0.0.1 >nul
goto :wait_gateway

:gateway_ready
echo [OK] Gateway attivo su http://127.0.0.1:8000

:start_web
echo.
echo [2/3] Avvio Wox Cinema Studio Pro Web Server (:3000)...
set "TARGET_URL=http://127.0.0.1:3000/#/app/cinema-studio"

start "" /b cmd /c "node -e ""(async()=>{for(let i=0;i<60;i++){try{const r=await fetch('http://127.0.0.1:3000');if(r.status<500)break;}catch{}await new Promise(r=>setTimeout(r,500));}})()"" && start """" ""%TARGET_URL%"""

echo.
echo ========================================================================
echo    WOX CINEMA STUDIO PRO E' OPERATIVO!
echo    Studio UI:     http://127.0.0.1:3000
echo    Video Studio:  http://127.0.0.1:3000/editor/
echo    ComfyUI:       http://127.0.0.1:8188
echo    Gateway API:   http://127.0.0.1:8000
echo ========================================================================
echo Premi [CTRL+C] in questa finestra per arrestare il server Web.
echo.

call npm run serve
goto :eof

:check_comfy
if defined FOUND_COMFY goto :eof
if "%~1"=="" goto :eof
if exist "%~1\main.py" (
    for %%I in ("%~1") do set "FOUND_COMFY=%%~fI"
)
goto :eof

:check_py
if defined FOUND_PYTHON goto :eof
if "%~1"=="" goto :eof
if not exist "%~1" goto :eof
"%~1" --version >nul 2>&1
if errorlevel 1 goto :eof
set "FOUND_PYTHON=%~1"
goto :eof

:check_proxy
if exist "%PY_DIR%comfy-api-proxy.exe" set "HAS_PROXY=1"
if exist "%PY_DIR%Scripts\comfy-api-proxy.exe" set "HAS_PROXY=1"
if exist "%PY_DIR%comfy-api-proxy" set "HAS_PROXY=1"
where comfy-api-proxy >nul 2>&1
if not errorlevel 1 set "HAS_PROXY=1"
goto :eof
