# MolOptima Desktop Launcher

MolOptima Phase 5A adds an Electron desktop launcher around the existing local application. It does not replace the FastAPI backend, React/Vite frontend, RDKit pipeline, local caches, run history, annotations, or export workflow.

This phase is a development desktop wrapper, not a signed Windows installer.

## What The Launcher Does

- Starts the FastAPI backend as a local child process.
- Uses `MOLOPTIMA_PYTHON` when set, otherwise uses `python` on `PATH`.
- Waits for `GET http://127.0.0.1:8000/health`.
- Starts the existing Vite frontend dev server unless `MOLOPTIMA_FRONTEND_URL` is set.
- Opens the React/MUI app in an Electron `BrowserWindow`.
- Stops the backend and frontend child processes when the Electron app exits.
- Shows a startup error dialog if the backend or frontend cannot become available.

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
set MOLOPTIMA_PYTHON=C:\Users\tpryt\miniconda3\envs\molecule-intelligence\python.exe
```

PowerShell equivalent:

```powershell
$env:MOLOPTIMA_PYTHON = "C:\Users\tpryt\miniconda3\envs\molecule-intelligence\python.exe"
```

If `MOLOPTIMA_PYTHON` is not set, the launcher uses `python` from `PATH`.

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

- This is a Phase 5A development launcher, not a packaged or signed installer.
- It does not bundle Python, RDKit, model weights, or public lookup caches.
- It depends on a local Python/Conda environment for the FastAPI backend and scientific functionality.
- It does not change scientific scoring, `priority_score`, public lookup behavior, run history, annotations, or exports.
