@echo off
setlocal
cd /d "%~dp0GPT-SoVITS-v3lora-20250228"
set "HF_HOME=%CD%\.cache\huggingface"
set "TRANSFORMERS_CACHE=%CD%\.cache\huggingface\transformers"
set "XDG_CACHE_HOME=%CD%\.cache"
if not exist "runtime\python.exe" (
  echo GPT-SoVITS runtime\python.exe was not found.
  pause
  exit /b 1
)
if not exist "api_v2.py" (
  echo GPT-SoVITS api_v2.py was not found.
  pause
  exit /b 1
)
echo Starting local GPT-SoVITS voice service on 127.0.0.1:9880...
runtime\python.exe api_v2.py -a 127.0.0.1 -p 9880
echo Voice service stopped. Exit code: %errorlevel%
pause
