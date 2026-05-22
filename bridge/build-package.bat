@echo off
chcp 65001 >nul
title BWP Scale Bridge - Build Package

echo ============================================
echo   Build .exe + รวมเป็น Package พร้อมแจก
echo ============================================
echo.

cd /d "%~dp0"

echo [1/3] Build BWPScaleBridge.exe...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] build ล้มเหลว
    pause
    exit /b 1
)

echo.
echo [2/3] รวม installer scripts...
copy /Y "installer\install.bat" "dist\install.bat" >nul
copy /Y "installer\uninstall.bat" "dist\uninstall.bat" >nul
copy /Y "installer\README.txt" "dist\README.txt" >nul

echo.
echo [3/3] สร้าง .zip...
powershell -Command "Compress-Archive -Path 'dist\*' -DestinationPath 'BWPScaleBridge-Setup.zip' -Force"

echo.
echo ============================================
echo   ✓ เสร็จแล้ว!
echo ============================================
echo.
echo ไฟล์พร้อมแจก:
echo   - dist\BWPScaleBridge.exe (47 MB)
echo   - dist\install.bat
echo   - dist\uninstall.bat
echo   - dist\README.txt
echo   - BWPScaleBridge-Setup.zip (ส่งให้ลูกค้า)
echo.
pause
