@echo off
chcp 65001 >nul
title ปิดเครื่องชั่ง

taskkill /f /im BWPScaleBridge.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo ปิดเครื่องชั่งแล้ว ✓
) else (
    echo เครื่องชั่งปิดอยู่แล้ว
)
timeout /t 2 /nobreak >nul
exit /b 0
