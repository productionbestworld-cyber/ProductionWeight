@echo off
chcp 65001 >nul
title เปิดเครื่องชั่ง

set EXE=BWPScaleBridge.exe
set EXE_PATH=
if exist "%ProgramFiles%\BWPScaleBridge\%EXE%" set EXE_PATH=%ProgramFiles%\BWPScaleBridge\%EXE%
if not defined EXE_PATH if exist "%~dp0%EXE%" set EXE_PATH=%~dp0%EXE%
if not defined EXE_PATH if exist "%~dp0dist\%EXE%" set EXE_PATH=%~dp0dist\%EXE%

if not defined EXE_PATH (
    echo [!] ไม่พบ %EXE% - วางไฟล์นี้ไว้ข้าง BWPScaleBridge.exe
    pause
    exit /b 1
)

tasklist /fi "imagename eq %EXE%" 2>nul | find /i "%EXE%" >nul 2>&1
if %errorlevel% equ 0 (
    echo เครื่องชั่งเปิดอยู่แล้ว ✓
) else (
    powershell -NoProfile -Command "Start-Process -FilePath '%EXE_PATH%' -WindowStyle Hidden" >nul 2>&1
    echo เปิดเครื่องชั่งแล้ว ✓
)

start http://localhost:8080
timeout /t 2 /nobreak >nul
exit /b 0
