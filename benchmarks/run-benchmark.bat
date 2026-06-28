@echo off
REM Run Artillery stress benchmark on Windows with throughput-friendly gateway settings
setlocal

set "ROOT_DIR=%~dp0.."
set "RESULTS_DIR=%~dp0results"
if not exist "%RESULTS_DIR%" mkdir "%RESULTS_DIR%"

echo ==^> Applying benchmark gateway profile...
set PII_MASK_MODE=regex
set MOCK_LLM_DELAY_MS=0
set RATE_LIMIT_RPM=360000
set MOCK_LLM_MODE=true

cd /d "%ROOT_DIR%"
docker compose up -d --no-deps --build gateway

echo ==^> Waiting for gateway...
timeout /t 5 /nobreak >nul

echo ==^> Running Artillery stress test...
call npx artillery run "%~dp0artillery\stress-test.yml" --output "%RESULTS_DIR%\report.json"

echo ==^> Generating HTML report...
call npx artillery report "%RESULTS_DIR%\report.json" --output "%RESULTS_DIR%\report.html"

echo ==^> Done. Results at benchmarks\results\
