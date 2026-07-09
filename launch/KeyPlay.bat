@echo off
title KeyPlay
rem Path-relative: this script lives in KeyPlay\launch\, so its parent is the repo root.
cd /d "%~dp0.."
echo.
echo   KeyPlay is starting...
echo   Your browser will open at http://127.0.0.1:8737/
echo.
echo   Keep this window open while you play. Close it to stop KeyPlay.
echo.
python -m keyplay
if errorlevel 1 (
  echo.
  echo   KeyPlay exited with an error. Make sure Python and the requirements are installed:
  echo       pip install -r requirements.txt
  echo.
  pause
)
