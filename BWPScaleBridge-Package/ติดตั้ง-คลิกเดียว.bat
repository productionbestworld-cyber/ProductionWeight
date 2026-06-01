@echo off
chcp 65001 >nul
title BWP Scale Bridge - ติดตั้งคลิกเดียว

REM ============================================================
REM  ขอสิทธิ์ Administrator อัตโนมัติ (Self-Elevate)
REM  ดับเบิลคลิกครั้งเดียว -> เด้ง UAC -> กด Yes -> ติดตั้งต่อเอง
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo กำลังขอสิทธิ์ผู้ดูแลระบบ... กรุณากด "Yes" ในหน้าต่างที่เด้งขึ้น
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP Scale Bridge - ติดตั้งอัตโนมัติ
echo ============================================
echo.

set "INSTALL_DIR=%ProgramFiles%\BWPScaleBridge"
set "EXE_NAME=BWPScaleBridge.exe"
set "SRC=%~dp0%EXE_NAME%"

REM ตรวจว่ามีไฟล์ .exe อยู่ข้างๆ ไหม
if not exist "%SRC%" (
    echo [ERROR] ไม่พบไฟล์ %EXE_NAME% ในโฟลเดอร์เดียวกับตัวติดตั้ง
    echo กรุณาวาง "ติดตั้ง-คลิกเดียว.bat" ไว้โฟลเดอร์เดียวกับ %EXE_NAME%
    echo.
    pause
    exit /b 1
)

echo [1/5] คัดลอกไฟล์ไปยัง %INSTALL_DIR% ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
REM ปิดตัวเก่าก่อน (ถ้าเปิดอยู่จะ copy ทับไม่ได้)
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
taskkill /f /im "%EXE_NAME%" >nul 2>&1
timeout /t 2 /nobreak >nul
copy /Y "%SRC%" "%INSTALL_DIR%\%EXE_NAME%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] คัดลอกไฟล์ไม่สำเร็จ
    pause
    exit /b 1
)

echo [2/5] ตั้งให้ทำงานเงียบ (ไม่มีหน้าต่าง console)...
powershell -NoProfile -Command ^
  "$f='%INSTALL_DIR%\%EXE_NAME%';" ^
  "$b=[IO.File]::ReadAllBytes($f);" ^
  "$o=[BitConverter]::ToInt32($b,0x3C);" ^
  "$s=$o+24+68;" ^
  "$b[$s]=2; $b[$s+1]=0;" ^
  "[IO.File]::WriteAllBytes($f,$b)" >nul 2>&1

echo [3/5] เปิด Firewall พอร์ต 8080 ...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

echo [4/5] ตั้งให้เปิดอัตโนมัติทุกครั้งที่เปิดเครื่อง ...
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul
if %errorlevel% neq 0 (
    schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onlogon /rl HIGHEST /f >nul
)

echo [5/5] เริ่มต้น Bridge ...
schtasks /run /tn "BWPScaleBridge" >nul 2>&1
timeout /t 3 /nobreak >nul

tasklist /fi "imagename eq %EXE_NAME%" 2>nul | find /i "%EXE_NAME%" >nul 2>&1
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo    ✓ ติดตั้งเรียบร้อย!  Bridge กำลังทำงาน
    echo ============================================
) else (
    echo.
    echo ============================================
    echo    ✓ ติดตั้งเรียบร้อย!  (จะเริ่มเองตอนเปิดเครื่องครั้งหน้า)
    echo ============================================
)
echo.
echo  • Bridge ทำงานที่: http://localhost:8080
echo  • เปิดอัตโนมัติทุกครั้งที่เปิดเครื่อง (ทำงานเบื้องหลัง เงียบ)
echo  • กำลังเปิดหน้าตั้งค่า COM port ให้...
echo.
timeout /t 2 /nobreak >nul
start http://localhost:8080
echo เสร็จแล้ว ปิดหน้าต่างนี้ได้เลย
echo.
pause
