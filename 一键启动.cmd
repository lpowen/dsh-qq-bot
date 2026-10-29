@echo off
chcp 65001 >nul
cd /d "%~dp0"

if exist "%~dp0state\bridge.lock" (
  echo [SKIP] Bridge already running - close that bridge window first.
  echo Lock file: %~dp0state\bridge.lock
  pause
  exit /b 0
)

netstat -ano | findstr ":6099" | findstr LISTENING >nul
if errorlevel 1 (
  echo Starting NapCat...
  start "NapCat" cmd /c "D:\NapCat\start-napcat.cmd"
  timeout /t 14 >nul
) else (
  echo NapCat already running.
)

echo Starting DSH bridge...
node bridge.mjs
echo.
echo Bridge exited.
pause