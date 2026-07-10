# Windows Packaging

MolOptima Phase 5B uses `electron-builder` to create a first Windows desktop package for the existing Electron launcher. The package includes the Electron shell, built React frontend, and MolOptima Python source needed to start the FastAPI backend. It does not bundle a standalone Python/RDKit runtime.

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
- Starts FastAPI with `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`.
- Loads the built React frontend from packaged resources.
- Keeps API calls pointed at `http://localhost:8000`.
- Uses the same local app data, backend metadata, run history, annotations, and export behavior as the browser and Electron development workflows.
- Uses optional PubChem, ChEMBL, and SureChEMBL internet calls only when those lookups are enabled.

## What Is Not Bundled

- Python
- Conda
- RDKit binary/runtime environment
- BBB/ChemBERTa model weights
- App-managed model cache contents
- PubChem, ChEMBL, or SureChEMBL cache contents
- Generated uploads, job outputs, job metadata, annotations, exports, or analysis files
- Cloud services or deployment tooling

## Git Hygiene

Do not commit generated desktop package output:

```text
desktop/dist/
desktop/out/
desktop/node_modules/
```

The package output is a local distributable artifact and should be regenerated from source when needed.
