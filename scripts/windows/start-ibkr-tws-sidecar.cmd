@echo off
REM Double-click wrapper for start-ibkr-tws-sidecar.ps1.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ibkr-tws-sidecar.ps1" %*
