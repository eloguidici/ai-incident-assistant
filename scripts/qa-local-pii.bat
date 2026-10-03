@echo off
setlocal
cd /d "%~dp0.."
node scripts/qa-local-pii.mjs %*
exit /b %errorlevel%
