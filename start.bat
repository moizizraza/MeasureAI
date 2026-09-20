@echo off
title MeasureAI Server
cd /d "%~dp0"
echo ===================================================
echo           Starting MeasureAI HTTPS Server
echo ===================================================
python -u server.py
pause
