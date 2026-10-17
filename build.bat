@echo off
cd /d "%~dp0"
echo [1/2] npm install...
call npm install || goto :err
echo [2/2] npm run build...
call npm run build || goto :err
echo.
echo Done! Installer is in the dist folder.
start "" "%~dp0dist"
pause
exit /b 0
:err
echo.
echo Build failed. See the message above or the troubleshooting section in README.md
pause
exit /b 1
