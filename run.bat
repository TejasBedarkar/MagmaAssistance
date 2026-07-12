@echo off
setlocal enabledelayedexpansion

rem ============================================================
rem  Voice Assistant ERP - Launcher
rem
rem  Requirements/venv/models/node_modules are assumed to already
rem  be installed. This script only launches things, in order:
rem    1. WSL -> frappe-bench -> bench start   (ERPNext backend)
rem    2. Python agent server (server.py)      (port 8050)
rem    3. Frontend dev server (npm run dev)
rem ============================================================

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%erp-portal-frontend-dev-ui"
set "BACKEND_PORT=8050"

echo ============================================
echo   Voice Assistant ERP - Launcher
echo ============================================
echo.

if exist "%ProgramFiles%\eSpeak NG\espeak-ng.exe" (
    set "PATH=%PATH%;%ProgramFiles%\eSpeak NG"
)

echo Step 1: Starting Frappe Bench (WSL)
echo -------------------------------------
rem NOTE: uses ~/frappe-bench (WSL Linux home), since bench init
rem       normally installs there, not under the Windows path this
rem       script runs from. "-lic" forces an interactive login shell
rem       so PATH/bench are resolved the same way as a normal terminal.
rem       "; exec bash" keeps the window open after bench start exits
rem       or errors, so you can actually read what happened.
start "Frappe Bench (WSL)" wsl bash -lic "cd ~/frappe-bench && bench start; exec bash"

echo.
echo Frappe Bench is starting up in its own window.
echo Watch that window until the site is up and serving, then come back
echo here and press any key to continue.
pause >nul

echo.
echo Step 2: Launching backend and frontend
echo -----------------------------------------

if exist "%BACKEND_DIR%\venv\Scripts\activate.bat" (
    start "Voice Assistant - Backend" cmd /k "cd /d "%BACKEND_DIR%" && call "%BACKEND_DIR%\venv\Scripts\activate.bat" && set "PORT=%BACKEND_PORT%" && python server.py"
) else (
    start "Voice Assistant - Backend" cmd /k "cd /d "%BACKEND_DIR%" && set "PORT=%BACKEND_PORT%" && python server.py"
)

start "Voice Assistant - Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && set "VITE_API_URL=http://localhost:%BACKEND_PORT%" && npm run dev"

echo.
echo All windows launching:
echo   Frappe Bench (WSL)
echo   Backend:  http://localhost:%BACKEND_PORT%
echo   Frontend: check the frontend window for its local dev URL
echo WARNING: if installed torch is cpu version so inference of TTS is slow, consider installing torch with GPU support for better performance.
echo.
pause