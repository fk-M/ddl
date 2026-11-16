@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  ==================================================
echo   DDL LAN server  (phone / tablet sync hub)
echo   Keep this window open. Press Ctrl+C to stop.
echo  ==================================================
echo.
echo  Checking port 3001 for an existing DDL service ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='SilentlyContinue'; try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3001/health' -TimeoutSec 2; $b=$r.Content | ConvertFrom-Json; $x=$r.Headers['X-Frame-Options']; if($b.status -eq 'ok' -and $x -ne 'DENY'){exit 10}else{exit 11} } catch { exit 12 }"
set PROBE=%ERRORLEVEL%

if "%PROBE%"=="10" goto REUSE
if "%PROBE%"=="11" goto STALE
goto START

:REUSE
echo.
echo  [OK] A current DDL service is already running on port 3001.
echo       Reusing it. A second process writing the same PGlite
echo       data directory would corrupt the database.
echo.
call npm run serve:lan
echo.
echo  The existing service is still running in its original window.
echo  Detection page: http://127.0.0.1:3001/diagnostics.html
echo.
pause
exit /b 0

:STALE
echo.
echo  [STOP] An OLD DDL service is still running on port 3001.
echo         It must be closed normally before a new one can start.
echo.
echo   1. Go to the old black window and press Ctrl+C
echo   2. Wait until it prints "Server stopped."
echo   3. Double-click start-lan.bat again
echo.
echo  This script will NOT force-kill node: force-killing while
echo  PGlite is open can leave an unrecoverable data directory.
echo.
pause
exit /b 1

:START
echo.
echo  Starting server. Watch for the self-check block below.
echo.
call npm run serve:lan
echo.
echo  Server stopped. Next time press Ctrl+C so PGlite can flush to disk.
pause
