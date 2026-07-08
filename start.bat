@echo off
title Process Improvement Agent

echo.
echo ================================================
echo   Process Improvement Agent - Yolex Labs
echo ================================================
echo.

REM Check for .env file
if not exist ".env" (
    echo [WARNING] .env file not found!
    echo Please copy .env.example to .env and add your GEMINI_API_KEY.
    echo.
    pause
    exit /b 1
)

echo [INFO] Installing/updating dependencies...
pip install -r requirements.txt --quiet

echo.
echo [INFO] Starting server at http://localhost:8000
echo [INFO] Press Ctrl+C to stop.
echo.

python main.py
pause
