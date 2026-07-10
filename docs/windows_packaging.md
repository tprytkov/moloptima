# Windows Packaging

MolOptima Phase 5B uses `electron-builder` to create a first Windows desktop package for the existing Electron launcher. The package includes the Electron shell, built React frontend, and MolOptima Python source needed to start the FastAPI backend. It does not bundle a standalone Python/RDKit runtime.

Phase 5C adds runtime setup diagnostics to the packaged shell so users can inspect Python configuration, backend health, frontend mode, app-data accessibility, and cache locations from the desktop app.

Phase 5D prepares the package to discover a bundled Python/RDKit runtime in a future release. The runtime itself is not committed or bundled in this phase.

Phase 5E adds local scripts for building and validating a runtime bundle under `desktop/runtime/python/`. The scripts are committed, but the runtime output remains ignored by Git.

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
- `MOLOPTIMA_PYTHON` set to that environment's `python.exe` when running the packaged app, unless a future bundled runtime is supplied.

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

## Build A Local Runtime Bundle

The local runtime bundle is built from the existing `molecule-intelligence` Conda environment. By default, the script expects:

```text
C:\Users\tpryt\miniconda3\envs\molecule-intelligence
```

Override that path with `MOLOPTIMA_CONDA_ENV` if needed:

```bat
set MOLOPTIMA_CONDA_ENV=C:\Users\tpryt\miniconda3\envs\molecule-intelligence
```

Build the runtime:

```bat
cd C:\MolOptima
scripts\build_desktop_runtime_windows.bat
```

If `conda-pack` is not installed, install it manually:

```bat
conda install -p "%MOLOPTIMA_CONDA_ENV%" -c conda-forge conda-pack -y
```

Or let the script install it:

```bat
scripts\build_desktop_runtime_windows.bat /install-conda-pack
```

Rebuild an existing runtime:

```bat
scripts\build_desktop_runtime_windows.bat /force
```

The script creates:

```text
desktop/runtime/python/python.exe
```

It validates that the runtime can import:

- `rdkit`
- `fastapi`
- `uvicorn`
- `pandas`
- `numpy`
- `backend.main`

It also starts the backend with the bundled Python and verifies `/health` when port 8000 is available.

Validate an existing runtime without rebuilding:

```bat
scripts\check_desktop_runtime_windows.bat
```

Skip the backend health startup check:

```bat
scripts\check_desktop_runtime_windows.bat /skip-health
```

After creating `desktop/runtime/python/`, package the app:

```bat
cd C:\MolOptima
cd desktop
npm.cmd run package
```

The Electron `afterPack` hook copies `desktop/runtime/` into packaged `resources/runtime/`.

To test the packaged app without `MOLOPTIMA_PYTHON`, open a new terminal and clear the variable for that process:

```bat
set MOLOPTIMA_PYTHON=
desktop\dist\win-unpacked\MolOptima.exe
```

Then open `MolOptima > Runtime Diagnostics` and confirm `Python source selected` reports `bundled runtime`.

## Runtime Behavior

The packaged app:

- Requires `MOLOPTIMA_PYTHON`.
- Resolves Python in this order: `MOLOPTIMA_PYTHON`, bundled runtime, then development-only `python` on `PATH`.
- Shows a clear startup error if Python is unavailable, points to a non-existent file, or the backend cannot become healthy.
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
- Python source selected: environment variable, bundled runtime, PATH fallback, or unavailable.
- Bundled runtime path checked and whether it exists.
- Whether `MOLOPTIMA_PYTHON` overrides a bundled runtime.
- Backend startup command.
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

## Future Bundled Runtime Support

Phase 5D supports the following future runtime layout:

Development tree:

```text
desktop/runtime/python/python.exe
desktop/runtime/python/python.dll
desktop/runtime/python/Lib/
desktop/runtime/python/Library/
desktop/runtime/python/Scripts/
```

Packaged app:

```text
resources/runtime/python/python.exe
resources/runtime/python/python.dll
resources/runtime/python/Lib/
resources/runtime/python/Library/
resources/runtime/python/Scripts/
```

Electron discovery order:

1. `MOLOPTIMA_PYTHON`
2. Bundled runtime Python at the paths above
3. `python` on `PATH`, only in development mode

Future maintainers can create a runtime archive from the current Conda environment with `conda-pack`:

```bat
conda activate molecule-intelligence
conda install -c conda-forge conda-pack
conda pack -p C:\Users\tpryt\miniconda3\envs\molecule-intelligence -o moloptima-runtime.zip
```

Unpack the archive into `desktop/runtime/python/` for development testing before packaging. During `npm.cmd run package` or `npm.cmd run dist`, the Electron `afterPack` hook copies `desktop/runtime/` to `resources/runtime/` if the folder exists. If the folder is absent, packaging continues without a bundled runtime.

The runtime must include RDKit, FastAPI, Uvicorn, and backend dependencies. Optional model libraries such as Transformers/Torch are only needed if BBB inference should work locally.

The scripts in `scripts/` automate this local workflow and are preferred over manual `conda-pack` commands for day-to-day packaging checks.

Do not include the following in the runtime bundle:

- BBB/ChemBERTa model weights by default
- `app_data/public_lookup_cache`
- generated uploads, outputs, metadata, annotations, or exports
- private data, secrets, or local unpublished compound data

`desktop/runtime/` is ignored by Git and should remain untracked.

## What Is Not Bundled

- Python
- Conda
- RDKit binary/runtime environment
- BBB/ChemBERTa model weights
- App-managed model cache contents
- PubChem, ChEMBL, or SureChEMBL cache contents
- Generated uploads, job outputs, job metadata, annotations, exports, or analysis files
- Cloud services or deployment tooling

Phase 5B/5C/5D remains a packaged desktop shell around a local scientific runtime. It is not a fully standalone executable until a runtime bundle is intentionally prepared and distributed outside Git.

## Git Hygiene

Do not commit generated desktop package output:

```text
desktop/dist/
desktop/out/
desktop/node_modules/
desktop/runtime/
```

The package output is a local distributable artifact and should be regenerated from source when needed.
