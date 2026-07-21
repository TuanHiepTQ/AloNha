@echo off
title AloNha
mode con:cols=70 lines=20
color 0B

echo ============================================
echo     ?? AloNha - ?ng d?ng nh?n tin b?o m?t
echo ============================================
echo.
echo ? ??ang kh?i ??ng server...
echo.

:: Kill any existing node on port 3000
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 "') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: Start server hidden and open browser
start /B /MIN "" node.exe start-alonha.js

:: Wait
timeout /t 10 /nobreak >nul

:: Open browser
start http://localhost:3000

cls
echo ============================================
echo     ?? AloNha - ?ng d?ng nh?n tin b?o m?t
echo ============================================
echo.
echo ? Server da san sang!
echo ? Tai khoan: SuperAdmin
echo ? Mat khau: 123456
echo.
echo ? Trinh duyet da duoc mo tu dong
echo.
echo ? ?ong cua so nay de dung server
echo ============================================
echo.
pause
