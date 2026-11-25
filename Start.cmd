@echo off
setlocal
where node.exe >nul 2>nul
if not errorlevel 1 (
  node.exe "%~dp0local-server.cjs" --open
  exit /b
)
set "EV_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%EV_NODE%" (
  "%EV_NODE%" "%~dp0local-server.cjs" --open
  exit /b
)
echo Node.js was not found. Install Node.js, then run Start.cmd again.
pause
exit /b 1
