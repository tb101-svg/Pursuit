@echo off
rem Opens Pursuit: starts it in the background if needed, then opens the app.
rem Pursuit keeps running after this window closes (and starts at login).
rem For development with live reload instead, run: npm run dev -- --port 3100
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-pursuit.ps1"
