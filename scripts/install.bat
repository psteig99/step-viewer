@echo off
cd /d "%~dp0\.."
python -m venv .venv
call .venv\Scripts\activate.bat
python -m pip install --upgrade pip
pip install -e ".[web,dev]"
echo.
echo Installation terminee. Lancez scripts\stepviewer.bat (visionneuse) ou scripts\web.bat (application web).
pause
