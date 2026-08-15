@echo off
title F1 Telemetry Command Center Server
cd /d "%~dp0"

:server_loop
echo [%date% %time%] Starting F1 Telemetry Command Center Server...
node --max-old-space-size=4096 server.js
echo.
echo ============================================================
echo [WARNING] Server stopped at %time% (Exit code: %errorlevel%)
echo Auto-restarting server in 2 seconds... (Press Ctrl+C to stop)
echo ============================================================
timeout /t 2 /nobreak >nul
goto server_loop