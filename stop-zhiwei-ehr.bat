@echo off
REM ZhiweiEHR one-click stopper: kills node processes holding ports 3000/5173/55432
setlocal
echo Stopping ZhiweiEHR services...

for %%P in (5173 3000 55432) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P " ^| findstr "LISTENING"') do (
    echo Killing PID %%A on port %%P
    taskkill /pid %%A /f >nul 2>&1
  )
)

echo.
echo All ZhiweiEHR services stopped.
timeout /t 5
