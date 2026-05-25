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

echo [1/5] Copy ไฟล์ไปยัง %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0%EXE_NAME%" "%INSTALL_DIR%\%EXE_NAME%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Copy ไฟล์ไม่สำเร็จ
    pause
    exit /b 1
)

echo [2/5] แปลง .exe เป็น GUI mode (ไม่มี console window)...
powershell -NoProfile -Command ^
  "$f='%INSTALL_DIR%\%EXE_NAME%';" ^
  "$b=[IO.File]::ReadAllBytes($f);" ^
  "$o=[BitConverter]::ToInt32($b,0x3C);" ^
  "$s=$o+24+68;" ^
  "$b[$s]=2; $b[$s+1]=0;" ^
  "[IO.File]::WriteAllBytes($f,$b)" >nul 2>&1

echo [3/5] เปิด Firewall port 8080...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

echo [4/5] ติดตั้งเป็น Windows Service (Auto-start เมื่อเปิดเครื่อง)...
REM หยุดและลบ task/service เก่า
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
taskkill /f /im %EXE_NAME% >nul 2>&1
timeout /t 2 /nobreak >nul

REM สร้าง Scheduled Task รันเป็น SYSTEM ตอน boot (ไม่ต้องรอ login)
REM SYSTEM account ไม่มี desktop session = ไม่มี console window เลย
schtasks /create ^
  /tn "BWPScaleBridge" ^
  /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" ^
  /sc onstart ^
  /ru SYSTEM ^
  /rl HIGHEST ^
  /f >nul
if %errorlevel% neq 0 (
    echo [WARN] Task แบบ SYSTEM ไม่สำเร็จ ลองแบบ HIGHEST user...
    schtasks /create ^
      /tn "BWPScaleBridge" ^
      /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" ^
      /sc onlogon ^
      /rl HIGHEST ^
      /f >nul
)

echo [5/5] เริ่มต้น Bridge (background)...
REM รัน task ทันทีโดยไม่ต้อง reboot
schtasks /run /tn "BWPScaleBridge" >nul 2>&1
timeout /t 3 /nobreak >nul

REM ตรวจสอบว่ารันสำเร็จ
tasklist /fi "imagename eq %EXE_NAME%" 2>nul | find /i "%EXE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo   ✓ ติดตั้งเรียบร้อย! Bridge กำลังทำงาน
    echo ============================================
) else (
    echo.
    echo ============================================
    echo   ✓ ติดตั้งเรียบร้อย! (Bridge จะเริ่มตอน reboot)
    echo ============================================
)

echo.
echo Bridge รันที่: http://localhost:8080
echo Bridge จะเริ่มอัตโนมัติทุกครั้งที่เปิดเครื่อง
echo ไม่มี console window - ทำงาน background เงียบๆ
echo.
echo เปิด browser เพื่อตั้งค่า COM port...
echo.
timeout /t 2 /nobreak >nul
start http://localhost:8080
pause
