@echo off
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" server.py --open %*
  pause
  exit /b
)
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 server.py --open %*
) else (
  python server.py --open %*
)
pause
