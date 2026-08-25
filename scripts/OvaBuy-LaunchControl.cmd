@echo off
setlocal EnableExtensions
title OvaBuy Launch Control
cd /d "%~dp0"

rem Preferred: open this from an elevated Master Launch Control so the child
rem inherits admin (no extra UAC). For service install from this cmd alone:
rem right-click → Run as administrator.

set "PS1=%~dp0OvaBuy-LaunchControl.ps1"
if not exist "%PS1%" (
  echo Missing "%PS1%"
  pause
  exit /b 1
)

set "PWSH=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PWSH%" set "PWSH=powershell.exe"

rem Hidden STA WinForms UI. Invoke directly (no `start ""`) so an elevated
rem Master Launch Control keeps its token. `start ""` uses ShellExecute and can drop elevation.
"%PWSH%" -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%PS1%" %*
exit /b %ERRORLEVEL%
