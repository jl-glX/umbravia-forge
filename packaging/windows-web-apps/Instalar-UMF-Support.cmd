@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Install-WebApp.ps1" -Application umf-support
if errorlevel 1 pause
