# MolOptima Desktop Launcher

MolOptima Phase 5A adds an Electron desktop launcher around the existing local application. It does not replace the FastAPI backend, React/Vite frontend, RDKit pipeline, local caches, run history, annotations, or export workflow.

Phase 5A is a development desktop wrapper. Phase 5B adds Windows packaging support for a first distributable desktop app, but it is still not a fully standalone scientific runtime.
Phase 5C adds desktop runtime diagnostics so users can confirm Python, backend health, frontend mode, app-data folders, and cache paths from the Electron shell.
Phase 5D prepares the launcher to use a bundled Python/RDKit runtime when one is supplied in a future release, while keeping `MOLOPTIMA_PYTHON` as the first-priority override.
Phase 5E adds local scripts to build and validate that runtime bundle under `desktop/runtime/python/` without committing runtime binaries.

Task 5 packages the exact validated GMC and regression CLI sources and their checksum manifest. Their scientific interpreters are separate from the general backend runtime: each family accepts its own explicit/environment override, otherwise selects its own packaged runtime, and fails closed if it is absent or incompatible. The large family runtimes and model archives remain externally provisioned release assets.

## What The Launcher Does

- Starts the FastAPI backend as a local child process.
- Resolves Python in this order: `MOLOPTIMA_PYTHON`, bundled runtime, then `python` on `PATH` for development mode only.
- Waits for `GET http://127.0.0.1:8000/health`.
- Starts the existing Vite frontend dev server unless `MOLOPTIMA_FRONTEND_URL` is set.
- In packaged mode, loads the built React frontend from packaged resources instead of starting Vite.
- Opens the React/MUI app in an Electron `BrowserWindow`.
- Stops the backend and frontend child processes when the Electron app exits.
- Shows a startup error dialog if the backend or frontend cannot become available, including `MOLOPTIMA_PYTHON` setup instructions.
- Provides a `MolOptima > Runtime Diagnostics` menu item with backend health, Python source, Python path, bundled runtime path, app-data path, frontend mode, package mode, backend startup command, and cache-location checks.

## Install Desktop Dependencies

From Anaconda Prompt or PowerShell:

```bat
cd C:\MolOptima
cd desktop
npm.cmd install
```

This installs Electron for the desktop launcher only. The scientific Python environment remains separate.

## Configure Python

The desktop launcher needs a Python environment with MolOptima backend dependencies, RDKit, FastAPI, and Uvicorn installed. Set `MOLOPTIMA_PYTHON` to the Conda environment Python executable:

```bat
set MOLOPTIMA_PYTHON=C:\path\to\conda-env\python.exe
```

PowerShell equivalent:

```powershell
$env:MOLOPTIMA_PYTHON = "C:\path\to\conda-env\python.exe"
```

If `MOLOPTIMA_PYTHON` is not set, the development launcher checks `desktop/runtime/python/python.exe` and then uses `python` from `PATH`.

For packaged MolOptima builds, the launcher checks `resources/runtime/python/python.exe` after `MOLOPTIMA_PYTHON`. If neither is available, the packaged app shows a startup error.

To set `MOLOPTIMA_PYTHON` permanently for the current Windows user:

```bat
setx MOLOPTIMA_PYTHON "C:\path\to\conda-env\python.exe"
```

Close and reopen Command Prompt, PowerShell, or the desktop app after running `setx`.

PowerShell persistent user setting:

```powershell
[Environment]::SetEnvironmentVariable(
  "MOLOPTIMA_PYTHON",
  "C:\path\to\conda-env\python.exe",
  "User"
)
```

Confirm the value:

```bat
echo %MOLOPTIMA_PYTHON%
```

## Run The Desktop App

```bat
cd C:\MolOptima
cd desktop
npm.cmd run dev
```

By default the launcher starts:

```text
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
npm.cmd run dev -- --host 127.0.0.1
```

The Electron window loads:

```text
http://127.0.0.1:5173/
```

The existing browser-based development mode still works:

```bat
cd C:\MolOptima
python -m uvicorn backend.main:app --reload
cd frontend
npm.cmd run dev
```

## Package A Windows Desktop Build

Install desktop dependencies first:

```bat
cd C:\MolOptima
cd desktop
npm.cmd install
```

Create an unpacked Windows package for local testing:

```bat
npm.cmd run package
```

This runs the frontend production build and then writes an unpacked Electron app under:

```text
desktop/dist/win-unpacked/
```

Create an NSIS installer build when needed:

```bat
npm.cmd run dist
```

Generated package files under `desktop/dist/` are ignored by Git and should not be committed.

The packaged app still requires a local Python/Conda environment. Before launching the packaged executable, set:

```bat
set MOLOPTIMA_PYTHON=C:\path\to\conda-env\python.exe
```

Then run:

```bat
desktop\dist\win-unpacked\MolOptima.exe
```

The packaged app starts FastAPI from the packaged MolOptima Python source copy and uses the configured local Python interpreter. It does not bundle Python, RDKit, Conda, model weights, public lookup caches, run outputs, or generated analysis files.

## Future Bundled Runtime Layout

Phase 5D supports, but does not commit, a future bundled Python/RDKit runtime. Expected development layout:

```text
desktop/runtime/python/python.exe
desktop/runtime/python/python.dll
desktop/runtime/python/Lib/
desktop/runtime/python/Library/
desktop/runtime/python/Scripts/
```

Expected packaged layout:

```text
resources/runtime/python/python.exe
resources/runtime/python/python.dll
resources/runtime/python/Lib/
resources/runtime/python/Library/
resources/runtime/python/Scripts/
```

`MOLOPTIMA_PYTHON` always overrides this bundled runtime. The runtime folder is ignored by Git and must not include BBB model weights, public lookup caches, or generated analyses.

Future maintainers can create a runtime bundle from the existing Conda environment with a tool such as `conda-pack`:

```bat
conda activate molecule-intelligence
conda install -c conda-forge conda-pack
conda pack -p C:\path\to\conda-env -o moloptima-runtime.zip
```

Unpack the archive into `desktop/runtime/python/` for development testing. The bundled runtime must include RDKit, FastAPI, Uvicorn, NumPy/Pandas-style dependencies used by the backend, and any optional model dependencies that should be available at runtime. BBB/ChemBERTa model weights remain outside the runtime unless a future release explicitly decides otherwise.

When `desktop/runtime/` exists, the Electron packaging hook copies it into `resources/runtime/` during `npm.cmd run package` or `npm.cmd run dist`. If the folder is absent, packaging continues without a bundled runtime.

Phase 5E provides scripts for the same workflow:

```bat
cd C:\MolOptima
scripts\build_desktop_runtime_windows.bat
scripts\check_desktop_runtime_windows.bat
```

If `conda-pack` is missing:

```bat
scripts\build_desktop_runtime_windows.bat /install-conda-pack
```

To rebuild an existing runtime:

```bat
scripts\build_desktop_runtime_windows.bat /force
```

To test runtime discovery without `MOLOPTIMA_PYTHON`:

```bat
set MOLOPTIMA_PYTHON=
cd C:\MolOptima
cd desktop
npm.cmd run dev
```

Open `MolOptima > Runtime Diagnostics` and confirm `Python source selected` reports `bundled runtime`.

To test a packaged app without `MOLOPTIMA_PYTHON` after creating the runtime:

```bat
set MOLOPTIMA_PYTHON=
cd C:\MolOptima
cd desktop
npm.cmd run package
cd ..
desktop\dist\win-unpacked\MolOptima.exe
```

## Runtime Diagnostics

Open the desktop menu:

```text
MolOptima > Runtime Diagnostics
```

Diagnostics include:

- Package mode: development or packaged.
- Frontend mode: Vite URL or packaged built frontend.
- Whether the frontend finished loading.
- Backend health from `GET http://127.0.0.1:8000/health`.
- Backend child process state and PID when available.
- Python path and whether `MOLOPTIMA_PYTHON` exists.
- Python source selected: environment variable, bundled runtime, PATH fallback, or unavailable.
- Bundled runtime path checked and whether it exists.
- Whether `MOLOPTIMA_PYTHON` overrides a bundled runtime.
- Backend startup command.
- Project root used by the desktop shell.
- App-data folder accessibility.
- BBB model cache path and accessibility.

## Manual Backend Test

From the same environment used by the desktop app:

```bat
cd C:\MolOptima
%MOLOPTIMA_PYTHON% -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Then check:

```bat
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok","service":"moloptima-backend"}
```

For packaged builds, the backend starts from the packaged Python source copy, but this manual test is still useful for confirming that the selected Conda/Python environment has RDKit, FastAPI, Uvicorn, and MolOptima dependencies available.

## Common Errors And Fixes

- `MOLOPTIMA_PYTHON is required`: set `MOLOPTIMA_PYTHON` to the Conda environment `python.exe`, then restart the desktop app.
- `No Python runtime is available`: set `MOLOPTIMA_PYTHON` or provide a future bundled runtime at `resources/runtime/python/python.exe`.
- `MOLOPTIMA_PYTHON does not exist`: check the path for typos or recreate/activate the Conda environment.
- Backend health timeout: confirm port 8000 is free, run the manual backend test, and check that RDKit/FastAPI/Uvicorn are installed in the selected environment.
- Frontend not found in packaged mode: run `cd desktop && npm.cmd run package` again so `frontend/dist` is rebuilt and included.
- BBB cache missing: this is allowed. BBB/ChemBERTa weights are not bundled; the app records BBB model status as unavailable unless local cached model files exist.
- Public lookup failures: PubChem, ChEMBL, and SureChEMBL require internet only when enabled for a run; cached results remain local.

## Optional Environment Variables

- `MOLOPTIMA_PYTHON`: Python executable used to start FastAPI.
- `MOLOPTIMA_BACKEND_URL`: backend URL checked by Electron, default `http://127.0.0.1:8000`.
- `MOLOPTIMA_FRONTEND_URL`: existing frontend URL to load. When set, Electron does not start Vite.
- `MOLOPTIMA_START_FRONTEND=0`: skip starting the Vite frontend child process.
- `MOLOPTIMA_BACKEND_TIMEOUT_MS`: backend startup wait timeout.
- `MOLOPTIMA_FRONTEND_TIMEOUT_MS`: frontend startup wait timeout.

## Local Data And Caches

The desktop launcher uses the same local storage as browser development mode:

- `app_data/model_cache/huggingface`
- `app_data/public_lookup_cache`
- `app_data/manifests`
- `backend/uploads`
- `backend/job_outputs`
- `backend/job_metadata`
- `backend/job_annotations`

BBB/ChemBERTa model weights are not bundled with Git or the desktop launcher. Normal app behavior uses local cached model files when available.

PubChem, ChEMBL, and SureChEMBL requests require internet access only when those optional public lookups are enabled for a run. Lookup results use the existing local cache.

## Limitations

- This is a Phase 5A/5B/5C/5D development launcher and first Windows package, not a signed production installer or fully standalone scientific runtime.
- It is prepared for a local bundled runtime, but this repository does not include Python, RDKit, model weights, or public lookup caches.
- It depends on a local Python/Conda environment for the FastAPI backend and scientific functionality.
- It does not change scientific scoring, `priority_score`, public lookup behavior, run history, annotations, or exports.
