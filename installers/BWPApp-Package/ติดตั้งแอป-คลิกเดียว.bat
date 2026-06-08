@echo off
chcp 65001 >nul
title BWP ระบบชั่ง - ติดตั้งแอป

REM ── ขอสิทธิ์ Administrator (เพื่อสร้างไอคอนให้ทุก user) ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo กำลังขอสิทธิ์ผู้ดูแลระบบ... กรุณากด Yes
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP ระบบชั่งน้ำหนัก - ติดตั้งแอป
echo ============================================
echo.

set "URL=https://production-weight.vercel.app"
set "INSTALL_DIR=%ProgramFiles%\BWPApp"
set "ICON=%INSTALL_DIR%\bwp.ico"

REM หา Chrome
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
    echo [ERROR] ไม่พบ Chrome หรือ Edge - กรุณาติดตั้ง Google Chrome ก่อน
    pause
    exit /b 1
)

echo [1/2] คัดลอกไอคอน ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0bwp.ico" "%ICON%" >nul

echo [2/2] สร้างไอคอน "BWP ระบบชั่ง" บนหน้าจอ + เมนู Start ...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonStartMenu')+'\Programs')){ $lnk=$w.CreateShortcut($d+'\BWP ระบบชั่ง.lnk'); $lnk.TargetPath='%BROWSER%'; $lnk.Arguments='--app=%URL% --window-size=1400,900'; $lnk.IconLocation='%ICON%,0'; $lnk.Save() }"

echo.
echo ============================================
echo    ติดตั้งเรียบร้อย!
echo ============================================
echo.
echo  - มีไอคอน "BWP ระบบชั่ง" บนหน้าจอ
echo  - ดับเบิลคลิก = เปิดระบบชั่งเต็มหน้าต่าง (เหมือนโปรแกรม)
echo  - กำลังเปิดให้ดูตัวอย่าง...
echo.
timeout /t 2 /nobreak >nul
start "" "%BROWSER%" --app=%URL% --window-size=1400,900
exit /b 0
