@echo off
setlocal
if not exist "%~dp0Install-WebApp.ps1" goto package_missing
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WebApp.ps1" -Application commercial -Uninstall
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo Desinstalacion completada.
) else (
  echo La desinstalacion no se ha completado. Revisa el error mostrado arriba.
)
echo Pulsa una tecla para cerrar esta ventana.
pause >nul
exit /b %RESULT%

:package_missing
echo ERROR: no se encuentra Install-WebApp.ps1.
echo Extrae el ZIP completo en una carpeta nueva antes de ejecutarlo.
echo Pulsa una tecla para cerrar esta ventana.
pause >nul
exit /b 1
