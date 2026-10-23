@echo off
setlocal
cd /d "%~dp0.."
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo Windows C# compiler was not found.
  exit /b 1
)
if not exist "runtime\sandbox" mkdir "runtime\sandbox"
"%CSC%" /nologo /target:exe /out:"runtime\sandbox\starry-sandbox.exe" /r:System.dll /r:System.Core.dll /r:System.Security.dll "native\sandbox-helper\starry-sandbox.cs"
exit /b %errorlevel%
