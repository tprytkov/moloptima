@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"

set "RUNTIME_PYTHON=%PROJECT_ROOT%\desktop\runtime\python\python.exe"
set "RUN_HEALTH_CHECK=1"

if /I "%~1"=="/skip-health" set "RUN_HEALTH_CHECK=0"

echo MolOptima desktop runtime validation
echo Project root:   %PROJECT_ROOT%
echo Runtime Python: %RUNTIME_PYTHON%

if not exist "%RUNTIME_PYTHON%" (
  echo ERROR: Runtime Python was not found.
  echo Expected: %RUNTIME_PYTHON%
  exit /b 1
)

set "PYTHONPATH=%PROJECT_ROOT%"

echo Checking Python imports...
"%RUNTIME_PYTHON%" -c "import sys; import rdkit; import fastapi; import uvicorn; import pandas; import numpy; import backend.main; print('ok: imports passed with', sys.executable)"
if errorlevel 1 exit /b 1

if "%RUN_HEALTH_CHECK%"=="0" (
  echo Skipping backend health check.
  exit /b 0
)

echo Checking backend /health with bundled runtime...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$python='%RUNTIME_PYTHON%';" ^
  "$root='%PROJECT_ROOT%';" ^
  "$env:PYTHONPATH=$root;" ^
  "$process=Start-Process -FilePath $python -ArgumentList @('-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000') -WorkingDirectory $root -PassThru -WindowStyle Hidden;" ^
  "try {" ^
  "  $ok=$false;" ^
  "  for ($i=0; $i -lt 30; $i++) {" ^
  "    Start-Sleep -Milliseconds 500;" ^
  "    try { $response=Invoke-RestMethod 'http://127.0.0.1:8000/health' -TimeoutSec 2; if ($response.status -eq 'ok') { $ok=$true; break } } catch {}" ^
  "  }" ^
  "  if (-not $ok) { throw 'Backend health check did not return ok.' }" ^
  "  Write-Host 'ok: backend /health passed';" ^
  "} finally {" ^
  "  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force }" ^
  "}"
if errorlevel 1 exit /b 1

echo Runtime validation passed.
exit /b 0
