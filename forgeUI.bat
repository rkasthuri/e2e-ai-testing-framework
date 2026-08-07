@echo off
REM FORGE — Autonomous Quality Engineering
REM Framework for Observed, Reasoned, and Grounded Evaluation
REM
REM Copyright (c) 2026 AnvilQ Technologies LLC
REM Author: Raj Kasthuri
REM
REM Proprietary and confidential.
REM Unauthorized copying, distribution, or modification
REM of this software is strictly prohibited.

title FORGE UI
cd /d "%~dp0"
echo Starting FORGE UI...
npx tsx src\core\onboarding\cli.ts ui
pause
