@echo off
chcp 65001 >nul
title BWP Scale Bridge - Installer

echo ============================================
echo   BWP Scale Bridge - Installer
echo ============================================
echo.

REM Check Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] กรุณา Run as Administrator
    echo คลิกขวาที่ install.bat แล้วเลือก "Run as administrator"
    pause
    exit /b 1
)

set INSTALL_DIR=%ProgramFiles%\BWPScaleBridge
set EXE_NAME=BWPScaleBridge.exe
set VBS_NAME=run-hidden.vbs

echo [1/4] Copy ไฟล์ไปยัง %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0%EXE_NAME%" "%INSTALL_DIR%\%EXE_NAME%" >nul
copy /Y "%~dp0%VBS_NAME%" "%INSTALL_DIR%\%VBS_NAME%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Copy ไฟล์ไม่สำเร็จ
    pause
    exit /b 1
)

echo [2/4] เปิด Firewall port 8080...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

echo [3/4] ติดตั้งเป็น Auto-start Task (Hidden background)...
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
REM kill exe เก่าก่อน
taskkill /f /im %EXE_NAME% >nul 2>&1
REM รัน vbs (hidden) ตอน logon → ไม่มี console window
schtasks /create /tn "BWPScaleBridge" /tr "wscript.exe \"%INSTALL_DIR%\%VBS_NAME%\"" /sc onlogon /rl HIGHEST /f >nul

echo [4/4] เริ่มต้น Service (background)...
start "" /b wscript.exe "%INSTALL_DIR%\%VBS_NAME%"
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   ✓ ติดตั้งเรียบร้อย!
echo ============================================
echo.
echo Bridge รันที่: http://localhost:8080
echo.
echo เปิด browser เพื่อตั้งค่า COM port...
echo.
start http://localhost:8080
pause
