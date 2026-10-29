@echo off
chcp 65001 >nul
cd /d "%~dp0"
title DSH QQ Bot
echo Starting DSH QQ bridge... (close this window to stop the bot)
echo.
node bridge.mjs
echo.
echo Bridge exited.
pause
