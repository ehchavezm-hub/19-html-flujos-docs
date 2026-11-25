@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Instalar complementos opcionales
echo Instala openpyxl (Excel e indice.xlsx), pypdf (buscar dentro de los PDF) y xlrd (.xls antiguos sin Office).
echo Requiere internet solo esta vez; el portal generado funciona sin internet.
echo.
set "PY="
py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY ( python --version >nul 2>nul && set "PY=python" )
if not defined PY (
  echo No se encontro Python 3 en esta PC. Instalalo desde https://www.python.org/downloads/
  pause
  exit /b 1
)
%PY% -m pip install --user --upgrade openpyxl pypdf xlrd
echo.
pause
