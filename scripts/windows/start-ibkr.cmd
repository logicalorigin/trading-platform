@echo off
REM Double-click wrapper for start-ibkr.ps1 so users don't have to fight
REM the PowerShell execution policy dialog.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-ibkr.ps1" %*
