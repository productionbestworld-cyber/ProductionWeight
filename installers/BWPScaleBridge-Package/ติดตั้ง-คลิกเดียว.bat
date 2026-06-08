@echo off
chcp 65001 >nul
title BWP Scale Bridge - ติดตั้งคลิกเดียว

REM ── ขอสิทธิ์ Administrator อัตโนมัติ ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo กำลังขอสิทธิ์ผู้ดูแลระบบ... กรุณากด Yes ในหน้าต่างที่เด้งขึ้น
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

if not exist "%SRC%" (
    echo [ERROR] ไม่พบไฟล์ %EXE_NAME% ในโฟลเดอร์เดียวกับตัวติดตั้ง
    echo กรุณาวางไฟล์ติดตั้งไว้โฟลเดอร์เดียวกับ %EXE_NAME%
    echo.
    pause
    exit /b 1
)

echo [1/5] คัดลอกไฟล์ไปยัง %INSTALL_DIR% ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
taskkill /f /im "%EXE_NAME%" >nul 2>&1
timeout /t 2 /nobreak >nul
copy /Y "%SRC%" "%INSTALL_DIR%\%EXE_NAME%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] คัดลอกไฟล์ไม่สำเร็จ
    pause
    exit /b 1
)
copy /Y "%~dp0BWPScalePanel.hta" "%INSTALL_DIR%\" >nul 2>&1
REM ทำให้ exe ไม่มีหน้าต่าง console (เปลี่ยน PE subsystem -> GUI)
powershell -NoProfile -Command "$f='%INSTALL_DIR%\%EXE_NAME%'; $b=[IO.File]::ReadAllBytes($f); $o=[BitConverter]::ToInt32($b,0x3C); $i=$o+24+68; $b[$i]=2; $b[$i+1]=0; [IO.File]::WriteAllBytes($f,$b)" >nul 2>&1

echo [2/5] เปิด Firewall พอร์ต 8080 ...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

echo [3/5] ตั้งให้เปิดอัตโนมัติทุกครั้งที่เปิดเครื่อง ...
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul
if %errorlevel% neq 0 schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onlogon /rl HIGHEST /f >nul

echo [4/5] สร้างไอคอน BWP Scale บนหน้าจอ ...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $lnk=$w.CreateShortcut(([Environment]::GetFolderPath('CommonDesktopDirectory')) + '\BWP Scale.lnk'); $lnk.TargetPath='mshta.exe'; $lnk.Arguments=('\"' + '%INSTALL_DIR%\BWPScalePanel.hta' + '\"'); $lnk.WorkingDirectory='%INSTALL_DIR%'; $lnk.IconLocation=('%INSTALL_DIR%\%EXE_NAME%' + ',0'); $lnk.Save()"

echo [5/5] เริ่มต้น Bridge ...
schtasks /run /tn "BWPScaleBridge" >nul 2>&1
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo    ติดตั้งเรียบร้อย!
echo ============================================
echo.
echo  - เปิดอัตโนมัติทุกครั้งที่เปิดเครื่อง
echo  - มีไอคอน BWP Scale บนหน้าจอ (เปิด/ปิด/ตั้งค่า)
echo  - กำลังเปิดหน้าต่างควบคุมเครื่องชั่งให้...
echo.
timeout /t 2 /nobreak >nul
start "" mshta.exe "%INSTALL_DIR%\BWPScalePanel.hta"
exit /b 0
