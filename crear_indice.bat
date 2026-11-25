@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Crear plantilla de indice
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo No se encontro Python 3 en esta PC. Instalalo desde https://www.python.org/downloads/
  pause
  exit /b 1
)
rem Elige la carpeta (o arrastrala sobre este .bat): crea indice_plantilla.csv dentro de ella
%PY% generar_portal.py %* --plantilla --abrir
echo.
pause
