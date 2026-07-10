# Windows Packaging

MolOptima Phase 5B uses `electron-builder` to create a first Windows desktop package for the existing Electron launcher. The package includes the Electron shell, built React frontend, and MolOptima Python source needed to start the FastAPI backend. It does not bundle a standalone Python/RDKit runtime.

Phase 5C adds runtime setup diagnostics to the packaged shell so users can inspect Python configuration, backend health, frontend mode, app-data accessibility, and cache locations from the desktop app.

## Packaging Tool

Packaging is configured in:

```text
desktop/package.json
```

The current tool is:

```text
electron-builder
```

## Prerequisites

- Node.js and npm for frontend and Electron packaging.
- A local Conda/Python environment with MolOptima backend dependencies, RDKit, FastAPI, and Uvicorn.
- `MOLOPTIMA_PYTHON` set to that environment's `python.exe` when running the packaged app.

Example:

```bat
set MOLOPTIMA_PYTHON=C:\Users\tpryt\miniconda3\envs\molecule-intelligence\python.exe
```

Set it permanently for the current Windows user:

```bat
setx MOLOPTIMA_PYTHON "C:\Users\tpryt\miniconda3\envs\molecule-intelligence\python.exe"
```

Close and reopen terminals or the desktop app after `setx`.

## Build Commands

From the repository root:

```bat
cd C:\MolOptima
cd desktop
npm.cmd install
npm.cmd run package
```

`npm.cmd run package` runs:

```text
cd ../frontend && npm.cmd run build
electron-builder --win dir
```

The unpacked Windows app is created under:

```text
desktop/dist/win-unpacked/
```

To create an NSIS installer build:

```bat
npm.cmd run dist
```

## Runtime Behavior

The packaged app:

- Requires `MOLOPTIMA_PYTHON`.
- Shows a clear startup error if `MOLOPTIMA_PYTHON` is missing, points to a non-existent file, or the backend cannot become healthy.
- Starts FastAPI with `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
- Loads the built React frontend from packaged resources.
- Keeps API calls pointed at `http://localhost:8000`.
- Uses the same local app data, backend metadata, run history, annotations, and export behavior as the browser and Electron development workflows.
- Uses optional PubChem, ChEMBL, and SureChEMBL internet calls only when those lookups are enabled.

## Runtime Diagnostics

In the desktop app, open:

```text
MolOptima > Runtime Diagnostics
```

The diagnostics dialog reports:

- Whether the app is running in development or packaged mode.
- Frontend mode and whether the frontend finished loading.
- Backend health from `/health`.
- Backend child process state.
- `MOLOPTIMA_PYTHON` and whether the file exists.
- Project root used by Electron.
- App-data folder access.
- BBB model cache path and access status.

## Manual Backend Test

Before packaging or when diagnosing a packaged launch failure:

```bat
cd C:\MolOptima
%MOLOPTIMA_PYTHON% -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok","service":"moloptima-backend"}
```

If this fails, fix the local Conda/Python environment before testing the packaged app.

## Common Errors

- Missing `MOLOPTIMA_PYTHON`: set it with `setx`, then restart the app.
- Python path does not exist: update the environment variable to the correct Conda environment.
- Backend health timeout: port 8000 may be in use, Uvicorn may be missing, or the selected Python environment may not have RDKit/FastAPI dependencies.
- BBB model cache path missing: allowed unless BBB inference is required; model weights are not bundled.
- Public lookup network errors: expected when optional PubChem, ChEMBL, or SureChEMBL lookup is enabled without internet access.

## What Is Not Bundled

- Python
- Conda
- RDKit binary/runtime environment
- BBB/ChemBERTa model weights
- App-managed model cache contents
- PubChem, ChEMBL, or SureChEMBL cache contents
- Generated uploads, job outputs, job metadata, annotations, exports, or analysis files
- Cloud services or deployment tooling

Phase 5B/5C remains a packaged desktop shell around a local scientific runtime. It is not a fully standalone executable.

## Git Hygiene

Do not commit generated desktop package output:

```text
desktop/dist/
desktop/out/
desktop/node_modules/
```

The package output is a local distributable artifact and should be regenerated from source when needed.
