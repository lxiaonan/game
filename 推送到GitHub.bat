@echo off
rem ASCII only in this file: cmd.exe mis-parses multi-byte characters in .bat files.
rem All Chinese text lives in tools\push_to_github.ps1 instead.
chcp 65001 >nul
title Push Xionger to GitHub
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\push_to_github.ps1"
set RC=%ERRORLEVEL%
echo.
if not "%RC%"=="0" (
  echo Script exited with code %RC%.
)
pause
exit /b %RC%
