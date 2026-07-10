@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
for %%I in ("%PROJECT_ROOT%") do set "PROJECT_ROOT=%%~fI"

if not defined MOLOPTIMA_CONDA_ENV (
  set "MOLOPTIMA_CONDA_ENV=C:\Users\tpryt\miniconda3\envs\molecule-intelligence"
)

set "RUNTIME_ROOT=%PROJECT_ROOT%\desktop\runtime"
set "RUNTIME_PYTHON_DIR=%RUNTIME_ROOT%\python"
set "RUNTIME_ARCHIVE=%RUNTIME_ROOT%\moloptima-runtime.zip"
set "FORCE_REBUILD=0"
set "INSTALL_CONDA_PACK=0"

:parse_args
if "%~1"=="" goto args_done
if /I "%~1"=="/force" (
  set "FORCE_REBUILD=1"
  shift
  goto parse_args
)
if /I "%~1"=="/install-conda-pack" (
  set "INSTALL_CONDA_PACK=1"
  shift
  goto parse_args
)
echo Unknown option: %~1
echo Usage: scripts\build_desktop_runtime_windows.bat [/force] [/install-conda-pack]
exit /b 2

:args_done
echo MolOptima desktop runtime build
echo Project root: %PROJECT_ROOT%
echo Conda env:    %MOLOPTIMA_CONDA_ENV%
echo Runtime dir:  %RUNTIME_PYTHON_DIR%

if not exist "%MOLOPTIMA_CONDA_ENV%\python.exe" (
  echo ERROR: Conda environment python.exe not found.
  echo Set MOLOPTIMA_CONDA_ENV to the environment path and retry.
  exit /b 1
)

where conda >nul 2>nul
if errorlevel 1 (
  echo ERROR: conda was not found on PATH. Run from Anaconda Prompt or initialize Conda first.
  exit /b 1
)

call conda run -p "%MOLOPTIMA_CONDA_ENV%" conda-pack --version >nul 2>nul
if errorlevel 1 (
  if "%INSTALL_CONDA_PACK%"=="1" (
    echo conda-pack not found. Installing conda-pack into %MOLOPTIMA_CONDA_ENV%...
    call conda install -p "%MOLOPTIMA_CONDA_ENV%" -c conda-forge conda-pack -y
    if errorlevel 1 exit /b 1
  ) else (
    echo ERROR: conda-pack is not installed in %MOLOPTIMA_CONDA_ENV%.
    echo Install it with:
    echo   conda install -p "%MOLOPTIMA_CONDA_ENV%" -c conda-forge conda-pack -y
    echo Or rerun this script with /install-conda-pack.
    exit /b 1
  )
)

if exist "%RUNTIME_PYTHON_DIR%" (
  if "%FORCE_REBUILD%"=="1" (
    echo Removing existing runtime directory...
    rmdir /s /q "%RUNTIME_PYTHON_DIR%"
    if errorlevel 1 exit /b 1
  ) else (
    echo ERROR: Runtime directory already exists.
    echo Use /force to rebuild it:
    echo   scripts\build_desktop_runtime_windows.bat /force
    exit /b 1
  )
)

if not exist "%RUNTIME_ROOT%" mkdir "%RUNTIME_ROOT%"
if exist "%RUNTIME_ARCHIVE%" del /f /q "%RUNTIME_ARCHIVE%"

echo Packing Conda environment. This can take several minutes...
call conda run -p "%MOLOPTIMA_CONDA_ENV%" conda-pack -p "%MOLOPTIMA_CONDA_ENV%" -o "%RUNTIME_ARCHIVE%" --force
if errorlevel 1 exit /b 1

echo Extracting runtime archive...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%RUNTIME_ARCHIVE%' -DestinationPath '%RUNTIME_PYTHON_DIR%' -Force"
if errorlevel 1 exit /b 1

if not "%KEEP_MOLOPTIMA_RUNTIME_ARCHIVE%"=="1" (
  del /f /q "%RUNTIME_ARCHIVE%"
)

if not exist "%RUNTIME_PYTHON_DIR%\python.exe" (
  echo ERROR: Runtime python.exe was not created at %RUNTIME_PYTHON_DIR%\python.exe
  exit /b 1
)

echo Runtime created at %RUNTIME_PYTHON_DIR%
call "%PROJECT_ROOT%\scripts\check_desktop_runtime_windows.bat"
exit /b %ERRORLEVEL%
