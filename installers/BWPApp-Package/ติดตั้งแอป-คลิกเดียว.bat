@echo off
chcp 65001 >nul
title BWP - Install App

REM ── Self-elevate to Administrator ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator... please click "Yes"
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP Weighing System - Install App
echo ============================================
echo.

set "URL=https://production-weight.vercel.app"
set "INSTALL_DIR=%ProgramFiles%\BWPApp"
set "ICON=%INSTALL_DIR%\bwp.ico"

REM Find Chrome (or Edge)
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined BROWSER if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined BROWSER (
    echo [ERROR] Chrome / Edge not found - please install Google Chrome first
    pause
    exit /b 1
)

echo [1/2] Copying icon ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%~dp0bwp.ico" "%ICON%" >nul

echo [2/2] Creating "BWP" shortcut on Desktop + Start Menu ...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; foreach($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonPrograms'))){ try { $lnk=$w.CreateShortcut((Join-Path $d 'BWP.lnk')); $lnk.TargetPath='%BROWSER%'; $lnk.Arguments='--app=%URL% --window-size=1400,900'; $lnk.IconLocation='%ICON%,0'; $lnk.Save() } catch {} }"

echo.
echo ============================================
echo    Done! Installed successfully.
echo ============================================
echo.
echo  - "BWP" icon is on your Desktop
echo  - Double-click it to open the weighing system (full window)
echo  - Opening a preview now...
echo.
timeout /t 2 /nobreak >nul
start "" "%BROWSER%" --app=%URL% --window-size=1400,900
exit /b 0
