@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Starry_night - Docker Desktop 启动器

:: Docker Desktop 的 WSL 后端有时需要管理员权限才能正常启动。
:: 首次运行会通过 UAC 重新以管理员身份启动本脚本。
for /f %%A in ('powershell -NoProfile -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"') do set "IS_ADMIN=%%A"
if /I not "!IS_ADMIN!"=="True" (
  echo 正在请求管理员授权以启动 Docker Desktop...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  if errorlevel 1 echo 未获得管理员授权，Docker Desktop 未启动。
  exit /b
)

set "DOCKER_DESKTOP="
for %%P in (
  "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  "%LocalAppData%\Docker\Docker Desktop.exe"
) do if exist "%%~P" set "DOCKER_DESKTOP=%%~P"

if not defined DOCKER_DESKTOP (
  echo.
  echo 未找到 Docker Desktop。请先完成 Docker Desktop 安装。
  echo 安装完成后，再双击此文件即可。
  pause
  exit /b 1
)

echo 正在启动 Docker Desktop...
start "Docker Desktop" "%DOCKER_DESKTOP%"

echo 等待 Docker 引擎就绪，最多约 90 秒...
set /a ATTEMPTS=0
:wait_for_docker
docker version --format "{{.Server.Version}}" >nul 2>&1
if not errorlevel 1 goto docker_ready
set /a ATTEMPTS+=1
if !ATTEMPTS! GEQ 45 goto docker_failed
timeout /t 2 /nobreak >nul
goto wait_for_docker

:docker_ready
echo.
echo Docker 引擎已启动，可以回到星空的“调试 - SearXNG 本地搜索”控制面板继续操作。
docker version --format "Docker Server: {{.Server.Version}}"
pause
exit /b 0

:docker_failed
echo.
echo Docker Desktop 已尝试启动，但引擎在 90 秒内仍不可用。
echo 请打开 Docker Desktop 查看提示；若显示 WSL 错误，请先重启电脑后再次运行本文件。
pause
exit /b 1
