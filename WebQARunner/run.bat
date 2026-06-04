@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] 가상환경이 없습니다. 아래 순서로 설치하세요:
    echo   1. python -m venv .venv
    echo   2. .venv\Scripts\activate.bat
    echo   3. pip install -r requirements.txt
    echo   4. playwright install chromium
    exit /b 1
)

call .venv\Scripts\activate.bat
python runner.py %*
endlocal
