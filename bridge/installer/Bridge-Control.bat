@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title BWP Scale Bridge - Control Panel

set EXE=BWPScaleBridge.exe
set TASK=BWPScaleBridge

REM หา exe — ลำดับ: ติดตั้งแล้ว > โฟลเดอร์เดียวกัน > dist
set EXE_PATH=
if exist "%ProgramFiles%\BWPScaleBridge\%EXE%" set EXE_PATH=%ProgramFiles%\BWPScaleBridge\%EXE%
if not defined EXE_PATH if exist "%~dp0%EXE%" set EXE_PATH=%~dp0%EXE%
if not defined EXE_PATH if exist "%~dp0dist\%EXE%" set EXE_PATH=%~dp0dist\%EXE%

:menu
cls
echo ============================================
echo    BWP Scale Bridge - แผงควบคุม
echo ============================================
echo.

REM เช็คสถานะ
tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo    สถานะ:  [ กำลังทำงาน ●  ]   http://localhost:8080
) else (
    echo    สถานะ:  [ ปิดอยู่ ○ ]
)

REM เช็ค auto-start
schtasks /query /tn "%TASK%" >nul 2>&1
if %errorlevel% equ 0 (
    echo    เปิดเอง:  ติดตั้งแล้ว ^(รันทุกครั้งที่เปิดเครื่อง^)
) else (
    echo    เปิดเอง:  ยังไม่ติดตั้ง
)

if not defined EXE_PATH (
    echo.
    echo    [!] ไม่พบ %EXE% - กรุณาวางไฟล์นี้ไว้ข้าง BWPScaleBridge.exe
)

echo.
echo --------------------------------------------
echo    [1]  เปิด Bridge
echo    [2]  ปิด Bridge
echo    [3]  เปิดหน้าตั้งค่า ^(browser^)
echo    [4]  ติดตั้งให้เปิดเองทุกครั้ง ^(ต้อง Admin^)
echo    [5]  ยกเลิกเปิดเอง ^(ต้อง Admin^)
echo    [0]  ออก
echo --------------------------------------------
echo.
set /p choice="   เลือก: "

if "%choice%"=="1" goto start
if "%choice%"=="2" goto stop
if "%choice%"=="3" goto open
if "%choice%"=="4" goto install
if "%choice%"=="5" goto uninstall
if "%choice%"=="0" exit /b 0
goto menu

:start
if not defined EXE_PATH ( echo    ไม่พบ exe & timeout /t 2 >nul & goto menu )
tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul 2>&1
if %errorlevel% equ 0 ( echo    Bridge ทำงานอยู่แล้ว & timeout /t 2 >nul & goto menu )
echo    กำลังเปิด...
start "" /b "%EXE_PATH%"
timeout /t 2 /nobreak >nul
goto menu

:stop
echo    กำลังปิด...
taskkill /f /im %EXE% >nul 2>&1
timeout /t 1 /nobreak >nul
goto menu

:open
start http://localhost:8080
goto menu

:install
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo    [!] ต้อง Run as administrator - คลิกขวาไฟล์นี้ เลือก Run as administrator
    timeout /t 4 >nul
    goto menu
)
if not defined EXE_PATH ( echo    ไม่พบ exe & timeout /t 2 >nul & goto menu )
set INSTALL_DIR=%ProgramFiles%\BWPScaleBridge
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%EXE_PATH%" "%INSTALL_DIR%\%EXE%" >nul
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul
schtasks /delete /tn "%TASK%" /f >nul 2>&1
schtasks /create /tn "%TASK%" /tr "\"%INSTALL_DIR%\%EXE%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% neq 0 schtasks /create /tn "%TASK%" /tr "\"%INSTALL_DIR%\%EXE%\"" /sc onlogon /rl HIGHEST /f >nul
schtasks /run /tn "%TASK%" >nul 2>&1
echo    ติดตั้งเปิดเองเรียบร้อย!
timeout /t 2 >nul
goto menu

:uninstall
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo    [!] ต้อง Run as administrator
    timeout /t 4 >nul
    goto menu
)
schtasks /end /tn "%TASK%" >nul 2>&1
schtasks /delete /tn "%TASK%" /f >nul 2>&1
echo    ยกเลิกเปิดเองแล้ว ^(Bridge ที่เปิดอยู่ยังทำงานต่อ^)
timeout /t 2 >nul
goto menu
