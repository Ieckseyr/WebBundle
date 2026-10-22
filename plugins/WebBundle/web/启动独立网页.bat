@echo off
setlocal
title WebBundle Standalone
pushd "%~dp0..\..\.."

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js was not found.
  echo Install Node.js 18 or newer and add it to PATH.
  echo.
  pause
  popd
  exit /b 1
)

netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo [INFO] A web server is already listening on port 8080.
  echo Opening http://127.0.0.1:8080
  start "" http://127.0.0.1:8080
  echo.
  pause
  popd
  exit /b 0
)

if not exist "tools\webbundle-web\config.json" (
  echo.
  echo First start: config.json will be created.
  echo Open http://127.0.0.1:8080/setup to create the admin account.
  echo.
)

echo.
echo WebBundle Standalone Web
echo URL:   http://127.0.0.1:8080
echo Setup: http://127.0.0.1:8080/setup
echo Data:  tools\webbundle-web\data\store.json
echo Press Ctrl+C or close this window to stop.
echo.

node "tools\webbundle-web\server.js"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%EXIT_CODE%"=="0" (
  echo [ERROR] Server exited with code %EXIT_CODE%
) else (
  echo Server stopped.
)
echo.
pause
popd
exit /b %EXIT_CODE%
