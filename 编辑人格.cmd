@echo off
chcp 65001 >nul
set "P=%USERPROFILE%\.dsh\persona\qq.md"
if not exist "%P%" (
  echo Persona file not found: %P%
  echo Run setup.ps1 first.
  pause
  exit /b 1
)
echo Opening persona file (save it, effective on the next message):
echo %P%
start "" notepad "%P%"
