@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20 or newer first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for the first run...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo Building the application...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

node launcher.js
set "APP_EXIT_CODE=%errorlevel%"
echo.
echo Local AI has stopped. Exit code: %APP_EXIT_CODE%
if not "%APP_EXIT_CODE%"=="0" (
  echo Please copy the error above for diagnosis.
  pause
)
exit /b %APP_EXIT_CODE%
