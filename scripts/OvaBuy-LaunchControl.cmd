@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0\.."

rem OvaBuy Launch Control — Next.js dev server (port 43123)
rem Master-facing entry for Master Launch Control (Generic adapter).
rem Invoke npm/node directly (no `start ""` for the server) so an elevated
rem Master Launch Control keeps its admin token on child processes.

set "ROOT=%CD%"
set "SCRIPTS=%~dp0"
set "URL=http://127.0.0.1:43123"
set "PORT=43123"
set "LOGDIR=%LOCALAPPDATA%\OvaBuy\logs"
set "ENVFILE=%ROOT%\.env"
set "ENVEXAMPLE=%ROOT%\.env.example"

if /i "%~1"=="start" goto :start
if /i "%~1"=="setup" goto :setup
if /i "%~1"=="open" goto :open
if /i "%~1"=="stop" goto :stop
if /i "%~1"=="status" goto :status
if /i "%~1"=="" goto :menu

echo Unknown action: %~1
echo Usage: %~nx0 [start^|setup^|open^|stop^|status]
exit /b 1

:menu
echo.
echo  OvaBuy Launch Control
echo  =====================
echo  APAC hardware ordering — Client Services to Procurement
echo.
echo  [1] Start dev server  (setup if needed, then npm run dev)
echo  [2] Setup only        (npm install, database, seed)
echo  [3] Open in browser   (%URL%)
echo  [4] Stop dev server   (port %PORT%)
echo  [5] Status
echo  [Q] Quit
echo.
choice /c 12345q /n /m "Select: "
if errorlevel 6 exit /b 0
if errorlevel 5 goto :status
if errorlevel 4 goto :stop
if errorlevel 3 goto :open
if errorlevel 2 goto :setup
if errorlevel 1 goto :start
goto :menu

:precheck
if not exist "%ROOT%\package.json" (
  echo ERROR: package.json not found in "%ROOT%"
  echo Run this script from the OvaBuy repo root via scripts\OvaBuy-LaunchControl.cmd
  exit /b 1
)
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node 20+ from https://nodejs.org/
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo ERROR: npm not found. Reinstall Node.js from https://nodejs.org/
  exit /b 1
)
exit /b 0

:ensure_env
if exist "%ENVFILE%" exit /b 0
if exist "%ENVEXAMPLE%" (
  echo Creating .env from .env.example ...
  copy /y "%ENVEXAMPLE%" "%ENVFILE%" >nul
  exit /b 0
)
echo Creating default .env ...
(
  echo DATABASE_URL="file:./dev.db"
  echo AUTH_SECRET="ovabuy-dev-secret-change-in-production"
  echo NEXTAUTH_URL="%URL%"
) > "%ENVFILE%"
exit /b 0

:setup
call :precheck
if errorlevel 1 exit /b 1
call :ensure_env

echo.
echo === OvaBuy setup ===
echo Root: %ROOT%
echo.

if not exist "%ROOT%\node_modules" (
  echo [1/3] npm install ...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed.
    exit /b 1
  )
) else (
  echo [1/3] node_modules present — skipping npm install
)

echo [2/3] Database migrate ...
call npm run db:deploy
if errorlevel 1 (
  echo ERROR: database migrate failed.
  echo Tip: do not run "npx prisma" — use "npm run db:migrate" or this Launch Control.
  exit /b 1
)

echo [3/3] Seed demo data ...
call npm run db:seed
if errorlevel 1 (
  echo ERROR: database seed failed.
  exit /b 1
)

echo.
echo Setup complete.
echo Demo login: cs.singapore@demo.local / demo123
echo.
if /i not "%~1"=="setup" exit /b 0
if "%~2"=="" pause
exit /b 0

:start
call :precheck
if errorlevel 1 exit /b 1
call :ensure_env

if not exist "%ROOT%\node_modules" (
  echo node_modules missing — running setup first ...
  call :setup silent
  if errorlevel 1 exit /b 1
)

if not exist "%ROOT%\prisma\dev.db" (
  echo Database missing — running migrate + seed ...
  call npm run db:deploy
  if errorlevel 1 exit /b 1
  call npm run db:seed
  if errorlevel 1 exit /b 1
)

if not exist "%LOGDIR%" mkdir "%LOGDIR%" 2>nul

echo.
echo Starting OvaBuy dev server on %URL%
echo Logs: %LOGDIR%\dev-server.log
echo Press Ctrl+C to stop.
echo Demo: cs.singapore@demo.local / demo123
echo.

rem Run dev server in foreground — MLC tracks this cmd/node process tree.
rem Do not use `start "" npm run dev` (drops inherited elevation).
call npm run dev
exit /b %ERRORLEVEL%

:open
start "" "%URL%/login"
exit /b 0

:stop
echo Stopping processes listening on port %PORT% ...
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano -p tcp ^| findstr ":%PORT% " ^| findstr LISTENING') do (
  set "FOUND=1"
  echo   taskkill /PID %%a /T /F
  taskkill /PID %%a /T /F >nul 2>&1
)
if "!FOUND!"=="0" (
  echo No listener on port %PORT%.
) else (
  echo Stopped.
)
exit /b 0

:status
call :precheck
if errorlevel 1 exit /b 1
echo.
echo Root:     %ROOT%
echo URL:      %URL%
echo .env:     %ENVFILE%  ^(exists: 
if exist "%ENVFILE%" (echo yes) else (echo no)
echo node_modules:
if exist "%ROOT%\node_modules" (echo yes) else (echo no)
echo Database:
if exist "%ROOT%\prisma\dev.db" (echo yes) else (echo no)
echo Port %PORT%:
netstat -ano -p tcp | findstr ":%PORT% " | findstr LISTENING >nul 2>&1
if errorlevel 1 (echo not listening) else (echo listening)
echo.
exit /b 0
