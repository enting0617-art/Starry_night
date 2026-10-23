@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Starry_night - Docker Desktop Launcher

REM Uses ASCII only: cmd.exe can safely run this file under any Windows code page.
for /f %%A in ('powershell -NoProfile -Command "([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)"') do set "IS_ADMIN=%%A"
if /I not "!IS_ADMIN!"=="True" (
  echo Requesting administrator approval for Docker Desktop...
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'cmd.exe' -ArgumentList '/c ""%~f0""' -Verb RunAs"
  if errorlevel 1 echo Administrator approval was not granted. Docker Desktop was not started.
  exit /b
)

set "DOCKER_DESKTOP="
for %%P in (
  "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
  "%LocalAppData%\Docker\Docker Desktop.exe"
  "%LocalAppData%\Programs\DockerDesktop\Docker Desktop.exe"
) do if exist "%%~P" set "DOCKER_DESKTOP=%%~P"

REM Per-user Docker installs place docker.exe in resources\bin. Resolve the app from it.
if not defined DOCKER_DESKTOP (
  for /f "delims=" %%D in ('where docker.exe 2^>nul') do (
    for %%R in ("%%~dpD..\..\Docker Desktop.exe") do if exist "%%~fR" set "DOCKER_DESKTOP=%%~fR"
  )
)

if not defined DOCKER_DESKTOP (
  echo.
  echo Docker Desktop was not found. Install Docker Desktop, then run this file again.
  pause
  exit /b 1
)

echo Starting Docker Desktop...
start "Docker Desktop" "%DOCKER_DESKTOP%"

echo Waiting for the Docker engine. This can take up to 90 seconds...
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
echo Docker engine is ready. Return to Starry_night and open the SearXNG control panel.
docker version --format "Docker Server: {{.Server.Version}}"
pause
exit /b 0

:docker_failed
echo.
echo Docker Desktop was started, but the engine was unavailable after 90 seconds.
echo Open Docker Desktop to see its error message. If it reports a WSL error, restart Windows and run this file again.
pause
exit /b 1
