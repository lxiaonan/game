@echo off
chcp 65001 >nul
title 熊二的世界
cd /d "%~dp0"
echo 正在启动《熊二的世界》...
python "%~dp0start_game.py"
if errorlevel 1 pause
