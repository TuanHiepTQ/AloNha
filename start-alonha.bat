@echo off
title AloNha Server
cd /d "%~dp0"

echo ================================================
echo    🚀 AloNha Server Launcher
echo ================================================
echo.

:: Kill any existing node process on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /f /pid %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo ⏳ Dang khoi dong AloNha Server...
echo.

:: Start the server
start /B "" "node.exe" server-fixed.js

:: Wait for server to start
timeout /t 8 /nobreak >nul

:: Open browser
echo ✅ Server da san sang!
echo.
echo 📝 Tai khoan: SuperAdmin / 123456
echo.
echo 🌐 Dang mo trinh duyet...
start http://localhost:3000

echo.
echo 📋 Dong cua so nay de dung server
echo.
pause
