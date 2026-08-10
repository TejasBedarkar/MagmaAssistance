@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "ROOT=%~dp0"
cd /d "%ROOT%"

set "BACKEND_DIR=%ROOT%"
set "VENV_DIR=%ROOT%venv"
set "REQ_FILE=%ROOT%requirements.txt"
set "MODEL_SCRIPT=%ROOT%ModelDownload.py"
set "BACKEND_PORT=8050"

echo ==================================================
echo        Voice Assistant ERP - Setup Launcher
echo ==================================================
echo.

:: --------------------------------------------------
:: Ask whether setup is already complete
:: --------------------------------------------------
choice /C YN /M "Have you already installed the project requirements?"

if errorlevel 2 goto setup
goto launch


:setup

echo.
echo ==============================
echo Checking Python 3.10
echo ==============================
echo.

py -3.10 --version

if errorlevel 1 (
    echo.
    echo ERROR: Python 3.10 was not found.
    echo.
    echo Installed Python versions:
    py -0p
    echo.
    pause
    exit /b 1
)

set "PYTHON=py -3.10"

echo.
echo Using:
%PYTHON% --version

echo.
echo ==============================
echo Creating Python Environment
echo ==============================
echo.

if not exist "%VENV_DIR%" (
    echo Creating virtual environment with Python 3.10...
    %PYTHON% -m venv "%VENV_DIR%"

    if errorlevel 1 (
        echo.
        echo ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
) else (
    echo Virtual environment already exists.
)

call "%VENV_DIR%\Scripts\activate.bat"

echo.
echo ==============================
echo Verifying Virtual Environment
echo ==============================
echo.

python --version
python -c "import sys; print('Python executable:'); print(sys.executable)"

echo.
echo ==============================
echo Upgrading pip
echo ==============================
echo.

python -m pip install --upgrade pip setuptools wheel

if errorlevel 1 (
    echo.
    echo ERROR: Failed to upgrade pip.
    pause
    exit /b 1
)

echo.
echo ==============================
echo Installing Requirements
echo ==============================
echo.

python -m pip install -r "%REQ_FILE%"

if errorlevel 1 (
    echo.
    echo ===============================================
    echo Requirements installation failed.
    echo.
    echo Trying again without cache...
    echo ===============================================
    echo.

    python -m pip install --no-cache-dir -r "%REQ_FILE%"
)

if errorlevel 1 (
    echo.
    echo ===============================================
    echo INSTALLATION FAILED
    echo ===============================================
    echo.
    echo Please check the error above.
    echo.
    pause
    exit /b 1
)

echo.
echo ==============================
echo Downloading AI Models
echo ==============================
echo.

python "%MODEL_SCRIPT%" ^
    --tool-rag-dir "%BACKEND_DIR%ERP\models\all-MiniLM-L6-v2"

if errorlevel 1 (
    echo.
    echo ===============================================
    echo Model download failed.
    echo ===============================================
    pause
    exit /b 1
)

echo.
echo ==========================================
echo Setup Completed Successfully.
echo ==========================================
echo.

:launch

echo.
echo ==========================================
echo Starting Voice Assistant Backend
echo ==========================================
echo.

if exist "%VENV_DIR%\Scripts\activate.bat" (
    start "Voice Assistant Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && call ""%VENV_DIR%\Scripts\activate.bat"" && set PORT=%BACKEND_PORT% && python server.py"
) else (
    start "Voice Assistant Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && set PORT=%BACKEND_PORT% && python server.py"
)

echo.
echo ==========================================
echo Backend Started
echo ==========================================
echo.
echo Backend : http://localhost:%BACKEND_PORT%
echo.
pause