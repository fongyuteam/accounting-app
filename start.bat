@echo off
cd /d "%~dp0"
echo.
echo  正在啟動帳務管理系統...
echo  啟動後請勿關閉此視窗
echo.
node server.js
pause
