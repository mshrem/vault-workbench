@echo off
setlocal
cd /d "%~dp0"
echo Setting up the optional local STL importer. Internet is needed once.
if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 -m venv .venv
) else (
  python -m venv .venv
)
if errorlevel 1 goto failed
:install
".venv\Scripts\python.exe" -m pip install --only-binary=:all: -r requirements-importer.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -c "import numpy, trimesh, fast_simplification, scipy.sparse"
if errorlevel 1 goto failed
echo.
echo Setup complete. Close the running app with Ctrl+C, then run start-windows.cmd.
echo Open Printer ^& files and click Start / resume import.
pause
exit /b 0
:failed
echo.
echo Setup did not finish. Use 64-bit Python 3.11 or newer and check your internet connection.
echo The existing configurator still works without the importer.
pause
exit /b 1
