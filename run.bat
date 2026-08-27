@echo off
title F1 Telemetry Command Center Server
pushd "%~dp0"
REM
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Closing process %%a using port 3000...
    taskkill /F /PID %%a >nul 2>&1
)
REM
node --max-old-space-size=4096 server.js
popd
pause