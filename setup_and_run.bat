 @echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"
set "VENV_DIR=%BACKEND_DIR%\venv"

echo ============================================
echo   Voice Assistant ERP - Setup and Launcher
echo ============================================
echo.

set /p ALREADY_INSTALLED="Have you already installed the requirements for this project? (Y/N): "
if /I "%ALREADY_INSTALLED%"=="Y" goto :launch

echo.
echo Step 1: Python virtual environment
echo -----------------------------------
echo   1. Use the current default 'python' command
echo   2. Choose a specific installed Python version
set /p PY_MODE="Enter 1 or 2 (default 1): "

if "%PY_MODE%"=="2" (
    echo.
    echo Installed Python versions found by the 'py' launcher:
    py -0p
    echo.
    set /p PY_VER="Enter the version to use (e.g. 3.11): "
    set "PY_CMD=py -!PY_VER!"
) else (
    set "PY_CMD=python"
)

if not exist "%VENV_DIR%" (
    echo.
    echo Creating virtual environment at "%VENV_DIR%" using: %PY_CMD%
    %PY_CMD% -m venv "%VENV_DIR%"
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to create the virtual environment.
        echo Check that "%PY_CMD%" is a valid Python command on this machine.
        pause
        exit /b 1
    )
) else (
    echo Virtual environment already exists at "%VENV_DIR%", skipping creation.
)

call "%VENV_DIR%\Scripts\activate.bat"
if errorlevel 1 (
    echo [ERROR] Failed to activate the virtual environment.
    pause
    exit /b 1
)

echo.
echo Step 2: Installing Python requirements
echo ---------------------------------------
set "PIP_CONSTRAINT=%BACKEND_DIR%\constraints.txt"
python -m pip install --upgrade pip
pip install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install Python requirements.
    pause
    exit /b 1
)

echo.
echo Step 3: Installing espeak-ng (required by Kokoro TTS)
echo --------------------------------------------------------
where espeak-ng >nul 2>nul
if errorlevel 1 (
    echo espeak-ng not found on PATH. Downloading installer from GitHub...
    set "ESPEAK_MSI=%TEMP%\espeak-ng-installer.msi"
    curl -L -o "!ESPEAK_MSI!" "https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi"
    if errorlevel 1 (
        echo.
        echo [WARNING] Could not download the espeak-ng installer automatically.
        echo Please install it manually from:
        echo   https://github.com/espeak-ng/espeak-ng/releases
    ) else (
        echo Installing espeak-ng ^(you may see a Windows admin/UAC prompt^)...
        msiexec /i "!ESPEAK_MSI!" /passive /norestart
        if errorlevel 1 (
            echo.
            echo [WARNING] espeak-ng installer did not report success. If Kokoro TTS
            echo fails later with a phonemizer/espeak error, install it manually from:
            echo   https://github.com/espeak-ng/espeak-ng/releases
        ) else (
            echo espeak-ng installed successfully.
        )
        del "!ESPEAK_MSI!" >nul 2>nul
    )
    rem Make the newly installed binary available to this session (and to the
    rem backend/frontend windows launched below, which inherit this PATH).
    if exist "%ProgramFiles%\eSpeak NG\espeak-ng.exe" (
        set "PATH=%PATH%;%ProgramFiles%\eSpeak NG"
    )
) else (
    echo espeak-ng already installed, skipping.
)

echo.
echo Step 4: Downloading models
echo ----------------------------
python "%BACKEND_DIR%\ModelDownload.py" ^
    --whisper-dir "%BACKEND_DIR%\WhisperSTT\model" ^
    --kokoro-dir "%BACKEND_DIR%\KokoroTTS\models\kokoro-82m" ^
    --tool-rag-dir "%BACKEND_DIR%\ERP\models\all-MiniLM-L6-v2"
if errorlevel 1 (
    echo.
    echo [ERROR] Model download failed.
    pause
    exit /b 1
)

echo.
echo Step 5: Installing frontend dependencies
echo ------------------------------------------
if not exist "%FRONTEND_DIR%\node_modules" (
    pushd "%FRONTEND_DIR%"
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed.
        popd
        pause
        exit /b 1
    )
    popd
) else (
    echo node_modules already present, skipping npm install.
)

echo.
echo Setup complete.

:launch
echo.
echo Launching backend and frontend in separate windows...
echo -------------------------------------------------------

if exist "%ProgramFiles%\eSpeak NG\espeak-ng.exe" (
    set "PATH=%PATH%;%ProgramFiles%\eSpeak NG"
)
 
set BACKEND_PORT=8001
 
if exist "%VENV_DIR%\Scripts\activate.bat" (
    start "Voice Assistant - Backend" cmd /k "cd /d "%BACKEND_DIR%" && call "%VENV_DIR%\Scripts\activate.bat" && set "PORT=%BACKEND_PORT%" && python server.py"
) else (
    start "Voice Assistant - Backend" cmd /k "cd /d "%BACKEND_DIR%" && set "PORT=%BACKEND_PORT%" && python server.py"
)
 
start "Voice Assistant - Frontend" cmd /k "cd /d "%FRONTEND_DIR%" && set "VITE_API_URL=http://localhost:%BACKEND_PORT%" && npm run dev"
 
echo.
echo Backend and frontend are starting up in their own windows.
echo   Backend:  http://localhost:%BACKEND_PORT%
echo   Frontend: http://localhost:5174
echo WARNING: if installed torch is cpu version so inference of TTS is slow, consider installing torch with GPU support for better performance.
echo.
pause