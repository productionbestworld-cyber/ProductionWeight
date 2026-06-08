@echo off
chcp 65001 >nul
title BWP Scale Bridge - Install

REM ── Self-elevate to Administrator ──
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting administrator... please click "Yes"
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs" >nul 2>&1
    exit /b
)

cls
echo ============================================
echo   BWP Scale Bridge - Install
echo ============================================
echo.

set "INSTALL_DIR=%ProgramFiles%\BWPScaleBridge"
set "EXE_NAME=BWPScaleBridge.exe"
set "SRC=%~dp0%EXE_NAME%"

if not exist "%SRC%" (
    echo [ERROR] %EXE_NAME% not found next to this installer
    echo Please keep the installer in the same folder as %EXE_NAME%
    echo.
    pause
    exit /b 1
)

echo [1/5] Copying files to %INSTALL_DIR% ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
schtasks /end /tn "BWPScaleBridge" >nul 2>&1
taskkill /f /im "%EXE_NAME%" >nul 2>&1
timeout /t 2 /nobreak >nul
copy /Y "%SRC%" "%INSTALL_DIR%\%EXE_NAME%" >nul
if %errorlevel% neq 0 (
    echo [ERROR] Copy failed
    pause
    exit /b 1
)
copy /Y "%~dp0BWPScalePanel.hta" "%INSTALL_DIR%\" >nul 2>&1
REM Make exe windowless (PE subsystem -> GUI)
powershell -NoProfile -Command "$f='%INSTALL_DIR%\%EXE_NAME%'; $b=[IO.File]::ReadAllBytes($f); $o=[BitConverter]::ToInt32($b,0x3C); $i=$o+24+68; $b[$i]=2; $b[$i+1]=0; [IO.File]::WriteAllBytes($f,$b)" >nul 2>&1

echo [2/5] Opening Firewall port 8080 ...
netsh advfirewall firewall delete rule name="BWP Scale Bridge" >nul 2>&1
netsh advfirewall firewall add rule name="BWP Scale Bridge" dir=in action=allow protocol=TCP localport=8080 >nul

echo [3/5] Set auto-start on boot ...
schtasks /delete /tn "BWPScaleBridge" /f >nul 2>&1
schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onstart /ru SYSTEM /rl HIGHEST /f >nul
if %errorlevel% neq 0 schtasks /create /tn "BWPScaleBridge" /tr "\"%INSTALL_DIR%\%EXE_NAME%\"" /sc onlogon /rl HIGHEST /f >nul

echo [4/5] Creating "BWP Scale" shortcut on Desktop ...
powershell -NoProfile -Command "try { $w=New-Object -ComObject WScript.Shell; $lnk=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('CommonDesktopDirectory')) 'BWP Scale.lnk')); $lnk.TargetPath='mshta.exe'; $lnk.Arguments=('\"' + '%INSTALL_DIR%\BWPScalePanel.hta' + '\"'); $lnk.WorkingDirectory='%INSTALL_DIR%'; $lnk.IconLocation=('%INSTALL_DIR%\%EXE_NAME%' + ',0'); $lnk.Save() } catch {}"

echo [5/5] Starting Bridge ...
schtasks /run /tn "BWPScaleBridge" >nul 2>&1
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo    Done! Installed successfully.
echo ============================================
echo.
echo  - Auto-starts on every boot
echo  - "BWP Scale" icon is on your Desktop (open/close/settings)
echo  - It auto-detects the scale COM port (just plug in the scale)
echo  - Opening the control panel now...
echo.
timeout /t 2 /nobreak >nul
start "" mshta.exe "%INSTALL_DIR%\BWPScalePanel.hta"
exit /b 0
