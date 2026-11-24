@echo off
setlocal
pushd "%~dp0" || exit /b 1

node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)" 2>nul
if errorlevel 1 (
    echo InsightForge requires Node.js 24 or later. Install it and run this file again.
    goto :failed
)

if not exist "node_modules\.package-lock.json" (
    echo Installing InsightForge dependencies...
    call npm.cmd ci --include=dev
    if errorlevel 1 goto :failed
)

if not defined INSIGHTFORGE_PORT set "INSIGHTFORGE_PORT=4317"
echo Once the server starts, open http://127.0.0.1:%INSIGHTFORGE_PORT% in your browser.
call npm.cmd run serve
if errorlevel 1 goto :failed
popd
exit /b 0

:failed
echo InsightForge could not start. See the message above.
pause
popd
exit /b 1
