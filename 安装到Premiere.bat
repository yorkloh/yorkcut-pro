@echo off
setlocal
set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\com.yorkcut.pro"
reg add "HKCU\Software\Adobe\CSXS.9" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.10" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.11" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.12" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.13" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.14" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.15" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
reg add "HKCU\Software\Adobe\CSXS.12" /v LogLevel /t REG_SZ /d 6 /f >nul
reg add "HKCU\Software\Adobe\CSXS.13" /v LogLevel /t REG_SZ /d 6 /f >nul
if not exist "%DEST%" mkdir "%DEST%"
xcopy "%SRC%*" "%DEST%\" /E /Y /I /Q /EXCLUDE:%SRC%install-exclude.txt >nul
REM Remove dev leftovers that xcopy cannot delete (it never removes extra files in DEST)
if exist "%DEST%\devtools" rd /s /q "%DEST%\devtools" >nul 2>nul
if exist "%DEST%\docs" rd /s /q "%DEST%\docs" >nul 2>nul
if exist "%DEST%\install-ffmpeg.ps1" del /f /q "%DEST%\install-ffmpeg.ps1" >nul 2>nul
if exist "%DEST%\install-exclude.txt" del /f /q "%DEST%\install-exclude.txt" >nul 2>nul
if exist "%DEST%\README.md" del /f /q "%DEST%\README.md" >nul 2>nul
if exist "%DEST%\js\selftest.js" del /f /q "%DEST%\js\selftest.js" >nul 2>nul
if exist "%DEST%\js\updater.js" del /f /q "%DEST%\js\updater.js" >nul 2>nul
if exist "%DEST%\js\license.js" del /f /q "%DEST%\js\license.js" >nul 2>nul
if exist "%DEST%\js\cloud-api.js" del /f /q "%DEST%\js\cloud-api.js" >nul 2>nul
echo.
echo Plugin installed.
echo.
echo ffmpeg is needed to turn the VIDEOS inside the voice / sfx / BGM folders into audio.
echo Without it those three tracks can only use plain audio files.
echo Picture tracks are not affected.
echo.
choice /C YN /N /M "Is ffmpeg already installed on this PC?  Y=yes, let me choose it   N=no, install it now : "
if errorlevel 2 goto installffmpeg
echo.
echo Select your ffmpeg.exe - the exe will be COPIED into the plugin folder.
powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%install-ffmpeg.ps1" -Mode Pick -PluginRoot "%DEST%"
if errorlevel 2 goto ffcancel
if errorlevel 1 goto fffail
goto done
:ffcancel
echo.
echo   Cancelled. Voice videos will not be converted until ffmpeg is installed.
echo   Run this installer again if you want to choose ffmpeg.
goto done
:installffmpeg
echo.
echo Installing ffmpeg into the plugin folder (download)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SRC%install-ffmpeg.ps1" -Mode Download -Dest "%DEST%\tools\ffmpeg"
if errorlevel 1 goto fffail
goto done
:fffail
echo.
echo   ffmpeg was NOT installed. Run this installer again to retry.
goto done
:done
echo.
echo Installed:
echo %DEST%
echo Quit Premiere completely, then open:
echo Window - Extensions - YorkCut Pro
pause
