@echo off
chcp 65001 >nul
title BWP Scale Bridge
cd /d "%~dp0"
echo เริ่มต้น BWP Scale Bridge...
echo เปิด UI ที่: http://localhost:8080
echo.
echo (ปิดหน้าต่างนี้เพื่อหยุด Bridge)
echo.
start http://localhost:8080
node server.js
pause
