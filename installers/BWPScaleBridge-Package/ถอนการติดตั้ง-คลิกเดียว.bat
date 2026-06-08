@echo off
chcp 65001 >nul
title BWP Scale Bridge - Uninstall

REM ── Self-elevate to Administrator ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP Scale Bridge - Uninstall
echo ============================================
echo.
set "INSTALL_DIR=%ProgramFiles%\BWPScaleBridge"

echo [1/4] Stop and remove task...
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1

echo [2/4] Stop program...
taskkill /f /im BWPScaleBridge.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [3/4] Remove firewall rule...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1

echo [4/4] Remove files + Desktop icon...
if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%"
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('CommonDesktopDirectory')+'\BWP Scale.lnk') -Force -ErrorAction SilentlyContinue" >nul 2>&1

echo.
echo ============================================
echo    Done! Uninstalled.
echo ============================================
echo.
pause
