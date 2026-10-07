@echo off
REM ============================================================
REM  ZhiweiEHR one-click launcher
REM  Double-click to start: Database + Backend + Web + Browser
REM  Content is pure ASCII to avoid GBK/UTF-8 encoding issues.
REM ============================================================
setlocal

set "ROOT=%~dp0"
set "NODE=C:\Users\86132\.workbuddy\binaries\node\versions\22.22.2\node.exe"
set "NPM=C:\Users\86132\.workbuddy\binaries\node\versions\22.22.2\npm.cmd"

if not exist "%NODE%" (
  echo [ERROR] Node not found: %NODE%
  pause
  exit /b 1
)

echo ============================================
echo   ZhiweiEHR starting...
echo ============================================

REM 1. Database (embedded PostgreSQL, port 55432)
echo [1/4] Starting database...
start "ZhiweiEHR-DB" /min cmd /k ""%NODE%" "%ROOT%server\scripts\dev-pg.js""
timeout /t 4 /nobreak >nul

REM 2. Backend API (port 3000)
echo [2/4] Starting backend...
start "ZhiweiEHR-API" /min cmd /k "cd /d "%ROOT%server" && "%NPM%" run start:dev"

REM 3. Web admin (port 5173)
echo [3/4] Starting web admin...
start "ZhiweiEHR-Web" /min cmd /k "cd /d "%ROOT%apps\admin-web" && "%NPM%" run dev"

echo [4/4] Waiting for services to come up...
timeout /t 25 /nobreak >nul

echo Opening browser...
start "" http://localhost:5173

echo.
echo ============================================
echo   All services started.
echo   Web:      http://localhost:5173
echo   Backend:  http://127.0.0.1:3000
echo   Accounts: 13900000001/2/3  Password: Passw0rd!
echo.
echo   Close the three minimized windows to stop.
echo   Or run stop-zhiwei-ehr.bat
echo ============================================
timeout /t 10
