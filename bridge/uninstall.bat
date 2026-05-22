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

echo [1/2] หยุดและลบ Task...
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1

echo [2/2] ลบ Firewall rule...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1

REM Kill any running node process
taskkill /f /im node.exe >nul 2>&1

echo.
echo ============================================
echo   ✓ ถอนการติดตั้งเรียบร้อย!
echo ============================================
echo.
pause
