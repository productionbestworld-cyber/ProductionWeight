@echo off
chcp 65001 >nul
title BWP ระบบชั่ง - ถอนการติดตั้ง
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)
echo กำลังลบไอคอน...
powershell -NoProfile -Command "Remove-Item ([Environment]::GetFolderPath('CommonDesktopDirectory')+'\BWP ระบบชั่ง.lnk') -Force -ErrorAction SilentlyContinue; Remove-Item ([Environment]::GetFolderPath('CommonStartMenu')+'\Programs\BWP ระบบชั่ง.lnk') -Force -ErrorAction SilentlyContinue"
if exist "%ProgramFiles%\BWPApp" rmdir /s /q "%ProgramFiles%\BWPApp"
echo ถอนการติดตั้งเรียบร้อย!
timeout /t 2 /nobreak >nul
exit /b 0
