@echo off
chcp 65001 >nul
title BWP Scale Bridge - ถอนการติดตั้งคลิกเดียว

REM ── ขอสิทธิ์ Administrator อัตโนมัติ ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo กำลังขอสิทธิ์ผู้ดูแลระบบ... กรุณากด "Yes"
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP Scale Bridge - ถอนการติดตั้ง
echo ============================================
echo.
set "INSTALL_DIR=%ProgramFiles%\BWPScaleBridge"

echo [1/4] หยุดและลบ Task...
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1

echo [2/4] หยุดโปรแกรม...
taskkill /f /im BWPScaleBridge.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [3/4] ลบ Firewall rule...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1

echo [4/4] ลบไฟล์ + ไอคอนบนหน้าจอ...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
powershell -NoProfile -Command "$d=[Environment]::GetFolderPath('CommonDesktopDirectory'); Remove-Item ($d+'\BWP Scale.lnk') -Force -ErrorAction SilentlyContinue" >nul 2>&1

echo.
echo ============================================
echo    ✓ ถอนการติดตั้งเรียบร้อย!
echo ============================================
echo.
pause
