@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Portal de documentos
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo No se encontro Python 3 en esta PC.
  echo Instalalo desde https://www.python.org/downloads/ y marca "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)
rem Sin argumentos se abre una ventana para elegir la carpeta; tambien se puede arrastrar la carpeta sobre este .bat
%PY% generar_portal.py %* --abrir
if errorlevel 1 (
  echo.
  echo Hubo un error. Revisa los mensajes de arriba.
)
echo.
pause
