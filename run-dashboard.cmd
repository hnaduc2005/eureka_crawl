@echo off
cd /d "%~dp0vote-dashboard"
echo Dang mo dashboard. Truy cap http://127.0.0.1:8787/
node scripts/dev.mjs
pause
