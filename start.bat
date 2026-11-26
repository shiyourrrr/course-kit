@echo off
chcp 936 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js（https://nodejs.org），装完再双击此文件。
  pause
  exit /b 1
)

powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:5178/api/decks' -UseBasicParsing -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {} ; exit 1"
if %errorlevel%==0 (
  echo 工作台已经在运行，正在打开浏览器……
  start "" "http://127.0.0.1:5178"
  exit /b 0
)

if not exist node_modules (
  echo 首次启动，正在安装依赖，只需一次……
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络。
    pause
    exit /b 1
  )
)

echo 正在启动工作台，浏览器会自动打开。关闭此窗口即停止服务。
node server.mjs --open
pause
