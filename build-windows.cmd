@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3.12 -c "import sys; assert sys.version_info[:2] == (3,12) and sys.maxsize > 2**32" >nul 2>nul
if errorlevel 1 goto use_python
py -3.12 windows\build.py
goto done
:use_python
python -c "import sys; assert sys.version_info[:2] == (3,12) and sys.maxsize > 2**32" >nul 2>nul
if errorlevel 1 goto missing_python
python windows\build.py
goto done
:missing_python
echo Building the EXE requires 64-bit Python 3.12 on this Windows PC.
echo The finished portable app does not require Python on the PC that runs it.
echo See WINDOWS.md for building on Windows or using the supplied GitHub workflow.
pause
exit /b 1
:done
set "VAULT_BUILD_RESULT=%errorlevel%"
pause
exit /b %VAULT_BUILD_RESULT%
