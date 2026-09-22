@echo off
title Masters Dashboard
cd /d "%~dp0"

REM Starts the local server and opens the dashboard in your browser.
REM If it is already running, this just reopens the tab and exits.
REM Close this window (or Ctrl+C) to stop the dashboard.
python server.py

REM Only hold the window open if something actually went wrong,
REM so a normal launch does not leave a console lying around.
if errorlevel 1 (
  echo.
  echo Dashboard failed to start - see the error above.
  echo If Python is missing, install it and tick "Add python.exe to PATH".
  pause
)
