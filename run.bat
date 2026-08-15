@echo off
title F1 Telemetry Command Center Server
pushd "%~dp0"
node --max-old-space-size=4096 server.js
popd
pause