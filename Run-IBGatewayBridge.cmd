@echo off
setlocal

cd /d "%~dp0"

if /i "%~1"=="paper" (
  shift
  call "%~dp0scripts\windows\start-ibkr-tws-sidecar.cmd" -Mode paper -TwsPort 4002 %*
) else (
  call "%~dp0scripts\windows\start-ibkr-tws-sidecar.cmd" %*
)
