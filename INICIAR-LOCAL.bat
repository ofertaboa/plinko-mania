@echo off
chcp 65001 >nul
title Plinko Mania — servidor local
cd /d "%~dp0"
echo.
echo  Iniciando servidor estatico em http://localhost:8080/
echo  (para trocar a porta: set PORT=3000)
echo.
start "" http://localhost:8080/
node tools\server.js
pause
