@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then run Start.bat again.
  pause
  exit /b 1
)

if not exist "node_modules\ws\package.json" (
  where npm >nul 2>nul
  if errorlevel 1 (
    echo npm is required to install the controller dependency. Reinstall Node.js with npm enabled.
    pause
    exit /b 1
  )
  echo Installing PC controller dependencies...
  call npm ci
  if errorlevel 1 (
    echo Dependency installation failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

node "%~dp0pc.js"
if errorlevel 1 pause
