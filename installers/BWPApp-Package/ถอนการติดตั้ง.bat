@echo off
chcp 65001 >nul
title BWP - Uninstall App
net session >nul 2>&1
if %errorlevel% neq 0 (
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)
echo Removing BWP app shortcut...
powershell -NoProfile -Command "foreach($d in @([Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('CommonPrograms'))){ Remove-Item (Join-Path $d 'BWP.lnk') -Force -ErrorAction SilentlyContinue }; Remove-Item ([Environment]::GetFolderPath('CommonDesktopDirectory')+'\BWP ระบบชั่ง.lnk') -Force -ErrorAction SilentlyContinue"
if exist "%ProgramFiles%\BWPApp" rmdir /s /q "%ProgramFiles%\BWPApp"
echo Done.
timeout /t 2 /nobreak >nul
exit /b 0
