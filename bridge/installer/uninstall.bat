@echo off
chcp 65001 >nul
title BWP Scale Bridge - Uninstaller

echo ============================================
echo   BWP Scale Bridge - Uninstaller
echo ============================================
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] กรุณา Run as Administrator
    pause
    exit /b 1
)

set INSTALL_DIR=%ProgramFiles%\BWPScaleBridge

echo [1/4] หยุดและลบ Task...
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1

echo [2/4] หยุด process...
taskkill /f /im BWPScaleBridge.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [3/4] ลบ Firewall rule...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1

echo [4/4] ลบไฟล์...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"

echo.
echo ============================================
echo   ✓ ถอนการติดตั้งเรียบร้อย!
echo ============================================
echo.
pause
