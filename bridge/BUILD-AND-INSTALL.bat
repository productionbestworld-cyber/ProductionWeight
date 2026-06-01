@echo off
chcp 65001 >nul
title BWP Scale Bridge - Build + Install

echo ============================================
echo   BWP Scale Bridge - Build + Install
echo ============================================
echo.

cd /d "%~dp0"

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Run as Administrator
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found - https://nodejs.org
    pause
    exit /b 1
)

set INSTALL_DIR=%ProgramFiles%\BWPScaleBridge
set EXE=BWPScaleBridge.exe
set VBS=%INSTALL_DIR%\run-hidden.vbs

echo [1/5] npm install...
call npm install
if %errorlevel% neq 0 ( echo [ERROR] npm install failed & pause & exit /b 1 )

echo [2/5] Build exe...
call npm run build
if %errorlevel% neq 0 ( echo [ERROR] build failed & pause & exit /b 1 )

echo [3/5] Copy to %INSTALL_DIR%...
taskkill /f /im %EXE% >nul 2>&1
timeout /t 2 /nobreak >nul
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "dist\%EXE%" "%INSTALL_DIR%\%EXE%" >nul
if %errorlevel% neq 0 ( echo [ERROR] Copy failed & pause & exit /b 1 )

echo Set o=CreateObject("WScript.Shell") > "%VBS%"
echo Set f=CreateObject("Scripting.FileSystemObject") >> "%VBS%"
echo p=f.GetParentFolderName(WScript.ScriptFullName) >> "%VBS%"
echo o.Run """" ^& p ^& "\%EXE%""", 0, False >> "%VBS%"

netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul
echo    Firewall OK

echo [4/5] Create scheduled task...
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
taskkill /f /im %EXE% >nul 2>&1
timeout /t 2 /nobreak >nul

schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul 2>&1
if %errorlevel% equ 0 (
    echo    Task: SYSTEM + boot OK
) else (
    schtasks /create /tn "BWPScaleBridge" /tr "wscript.exe \"%VBS%\"" /sc onlogon /rl HIGHEST /f >nul
    echo    Task: user + logon + hidden OK
)

echo [5/5] Start bridge now...
schtasks /run /tn "BWPScaleBridge" >nul 2>&1
timeout /t 3 /nobreak >nul

tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul 2>&1
if %errorlevel% neq 0 (
    echo    Trying VBS launch...
    start "" /b wscript.exe "%VBS%"
    timeout /t 3 /nobreak >nul
)

REM แพ็คเฉพาะไฟล์ที่ผู้ใช้ต้องใช้: exe + แผงควบคุม + คู่มือ
del /Q "dist\install.bat" "dist\uninstall.bat" "dist\README.txt" "dist\run-hidden.vbs" >nul 2>&1
copy /Y "installer\เครื่องชั่ง.hta" "dist\เครื่องชั่ง.hta" >nul 2>&1
copy /Y "installer\เปิดเครื่องชั่ง.bat" "dist\เปิดเครื่องชั่ง.bat" >nul 2>&1
copy /Y "installer\ปิดเครื่องชั่ง.bat" "dist\ปิดเครื่องชั่ง.bat" >nul 2>&1
copy /Y "installer\Bridge-Control.bat" "dist\Bridge-Control.bat" >nul 2>&1
copy /Y "README.md" "dist\README.md" >nul 2>&1
powershell -NoProfile -Command "Compress-Archive -Path 'dist\*' -DestinationPath 'BWPScaleBridge-Setup.zip' -Force" >nul 2>&1

echo.
echo ============================================
tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo   SUCCESS - Bridge is running!
    echo   URL: http://localhost:8080
    echo   Auto-start: every boot
    echo   ZIP ready: BWPScaleBridge-Setup.zip
) else (
    echo   Installed OK - Bridge will start on reboot
    echo   Or run: schtasks /run /tn "BWPScaleBridge"
)
echo ============================================
echo.
start http://localhost:8080
pause
