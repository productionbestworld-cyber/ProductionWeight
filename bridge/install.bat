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

REM Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] ไม่พบ Node.js
    echo กรุณาติดตั้ง Node.js จาก https://nodejs.org ก่อน
    pause
    exit /b 1
)

echo [1/4] ตรวจสอบ Node.js... OK
node -v

REM Install dependencies
echo.
echo [2/4] ติดตั้ง dependencies...
cd /d "%~dp0"
call npm install --production
if %errorlevel% neq 0 (
    echo [ERROR] npm install ล้มเหลว
    pause
    exit /b 1
)

REM Open firewall port 8080
echo.
echo [3/4] เปิด Firewall port 8080...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

REM Register as Windows Task (auto-start on boot)
echo.
echo [4/4] ติดตั้งเป็น Task อัตโนมัติ...
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1

set SCRIPT_PATH=%~dp0server.js
set NODE_PATH=
for /f "delims=" %%i in ('where node') do set NODE_PATH=%%i

schtasks /create /tn "BWPScaleBridge" /tr "\"%NODE_PATH%\" \"%SCRIPT_PATH%\"" /sc onstart /ru "SYSTEM" /rl HIGHEST /f >nul

REM Start the task now
schtasks /run /tn "BWPScaleBridge" >nul

echo.
echo ============================================
echo   ✓ ติดตั้งเรียบร้อย!
echo ============================================
echo.
echo Bridge รันที่: http://localhost:8080
echo.
echo เปิด browser ไปที่ลิงก์ด้านบน เพื่อตั้งค่า COM port
echo.
echo ระบบจะรัน auto ทุกครั้งที่เปิดเครื่อง
echo.
pause
start http://localhost:8080
