@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist portfolio.html (
  echo 找不到 portfolio.html，请确认和本文件在同一个文件夹。
  pause
  exit /b 1
)
start "" "portfolio.html"