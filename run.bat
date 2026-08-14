@echo off
title Node Server
cd /d "%~dp0"
node --max-old-space-size=4096 server.js
pause