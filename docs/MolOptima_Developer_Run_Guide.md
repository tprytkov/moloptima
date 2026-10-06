# MolOptima Developer Run Guide

This guide describes the current P2.8 repository commands and runtime resolution implemented at checkpoint `3e45a64`. Commands use Windows Anaconda Prompt syntax unless marked PowerShell. Run them from a public-safe local checkout path such as `MolOptima`; do not embed a maintainer's personal path in committed configuration or documentation.

## 1. Repository Structure

```text
backend/                   FastAPI routes, services, persistence, and result packaging
biopharma_intelligence/    Local identity, similarity, and evidence helpers
data/                      Public-safe demo and reference data
desktop/                   Electron lifecycle, packaging config, and local runtime staging
docs/                      Maintainer and user documentation
frontend/                  React, MUI, and Vite interface
molecular_prioritization/  Input, descriptors, ADMET, docking, profiles, and scoring logic
resources/                 Versioned manifests, runners, native tools, and profile resources
scripts/                   Windows runtime build/check and release qualification scripts
tests/                     Python test suite
app_data/                  Local model resources, caches, manifests, and generated analysis data
```

Generated uploads, jobs, caches, runtime staging, and desktop distributions are local artifacts. Consult `.gitignore` before adding any runtime or release output.

## 2. Backend Development Environment

The repository's current documentation uses the Conda environment `molecule-intelligence` with Python 3.11 and the project dependencies, including RDKit, FastAPI, Uvicorn, NumPy, pandas, and pytest. The repository does not currently provide a root `requirements.txt` or `environment.yml`, so create/update environments through the project's controlled maintainer process rather than inferring an installation command.

```bat
conda activate molecule-intelligence
cd MolOptima
```

For Electron development, `MOLOPTIMA_PYTHON` may identify that environment's interpreter:

```bat
set MOLOPTIMA_PYTHON=C:\path\to\conda-env\python.exe
```

Do not store a machine-specific environment path in Git.

## 3. Backend Startup

From the repository root:

```bat
python -m uvicorn backend.main:app --reload
```

The frontend expects the API at `http://localhost:8000`; the Electron launcher's default backend address is `http://127.0.0.1:8000`.

## 4. Frontend Dependency Installation

From the repository root:

```bat
cd frontend
npm.cmd install
```

Both `frontend/package-lock.json` and `desktop/package-lock.json` are present. Keep lockfiles consistent with intentional dependency changes.

## 5. Frontend Development Startup

With the backend running in another terminal:

```bat
cd MolOptima
cd frontend
npm.cmd run dev
```

Open the URL printed by Vite, normally `http://127.0.0.1:5173/`.

## 6. Electron Development Mode

The Electron `dev` and `start` scripts both run `electron .`. The launcher starts the backend, starts Vite unless configured otherwise, waits for health, and opens the React UI.

```bat
conda activate molecule-intelligence
cd MolOptima
set MOLOPTIMA_PYTHON=C:\path\to\conda-env\python.exe
cd desktop
npm.cmd install
npm.cmd run dev
```

By default, development mode may fall back to `python` on `PATH` if neither an override nor a staged general runtime is available. An explicit interpreter is preferable for reproducible maintenance.

## 7. Backend Health Endpoint

The local health endpoint is:

```text
GET http://127.0.0.1:8000/health
```

PowerShell check:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
```

Expected payload:

```json
{"status":"ok","service":"moloptima-backend"}
```

The Electron launcher waits for this endpoint before completing startup.

## 8. Relevant Environment-Variable Resolution

Electron and backend launch behavior:

- `MOLOPTIMA_PYTHON` — first-priority general backend interpreter.
- `MOLOPTIMA_BACKEND_URL` — backend URL; default `http://127.0.0.1:8000`.
- `MOLOPTIMA_FRONTEND_URL` — use an existing frontend URL instead of the normal frontend source.
- `MOLOPTIMA_START_FRONTEND=0` — prevent Electron from starting Vite in development mode.
- `MOLOPTIMA_BACKEND_TIMEOUT_MS` — Electron backend-start wait; source default is 45,000 ms.
- `MOLOPTIMA_FRONTEND_TIMEOUT_MS` — Electron frontend-start wait; source default is 45,000 ms.

Model and native-tool behavior:

- `MOLOPTIMA_ADMET_RELEASE_ROOT` — first-priority frozen ADMET model-release root.
- `MOLOPTIMA_GMC_PYTHON`, `MOLOPTIMA_GMC_RUNNER` — GMC-MPNN family overrides.
- `MOLOPTIMA_CHEMPROP_PYTHON`, `MOLOPTIMA_CHEMPROP_RUNNER` — Chemprop family overrides.
- `MOLOPTIMA_RECEPTOR_REPAIR_PYTHON` — isolated PDBFixer 1.12.0/OpenMM 8.6.1 interpreter used by conservative receptor repair.
- `MOLOPTIMA_BBB_MODEL_CACHE` — cache-root override for the legacy Hugging Face BBB cache diagnostics.
- `MOLOPTIMA_ALLOW_MODEL_DOWNLOAD=1` — explicitly permits download for that legacy cache path; normal loading is otherwise offline/fail-closed.
- `MOLOPTIMA_VINA_PATH` — Vina executable override; `MOLOPTIMA_VINA_EXECUTABLE` is the compatibility alias.
- `MOLOPTIMA_OBABEL_PATH` — Open Babel executable override; `MOLOPTIMA_OBABEL_EXECUTABLE` is the compatibility alias.
- `MOLOPTIMA_VINA_TIMEOUT_SECONDS` — per-molecule Vina timeout; source default is 1,800 seconds.

Runtime-build behavior:

- `MOLOPTIMA_CONDA_ENV` — source environment path used by `build_desktop_runtime_windows.bat`.
- `KEEP_MOLOPTIMA_RUNTIME_ARCHIVE=1` — retain the temporary general-runtime ZIP after the build script extracts it.

Environment overrides are maintainer controls. The qualified installed release normally resolves its bundled resources without them.

## 9. Scientific Runtime Resolution

### General backend runtime

`desktop/main.js` resolves the backend interpreter in this order:

1. `MOLOPTIMA_PYTHON`;
2. `desktop/runtime/python/python.exe` in a source checkout, or `resources/runtime/python/python.exe` in a package;
3. `python` on `PATH`, in development mode only; otherwise fail closed.

Electron launches:

```text
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

### Isolated GMC-MPNN and Chemprop runtimes

These families never substitute the general backend interpreter or each other's runtime. Each resolves an explicit constructor override, its family environment variable, then its packaged family Python and SHA-verified runner; otherwise it fails closed. Packaged candidates are declared in `resources/admet/runtime_manifest.json` and install under:

```text
resources/runtime/admet/gmc_mpnn_bbb/python/python.exe
resources/runtime/admet/chemprop_regression/python/python.exe
```

The resolver checks Chemprop, Lightning, NumPy, RDKit, and Torch versions against the authoritative model production manifest. Scientific Runtime probes use the existing 300-second per-family timeout.

### ChemBERTa and native tools

ChemBERTa loads its frozen local model/cache resources without an implicit download. Vina and Open Babel resolve explicit overrides first, then verified packaged executables/resources. Meeko and Gemmi are provided by the general bundled backend runtime and checked against the qualified versions in the runtime validation script.

## 10. Model-Resource Provisioning

Frozen ADMET model releases are large release assets and are not ordinary Git source. Resolution is:

1. `MOLOPTIMA_ADMET_RELEASE_ROOT` when configured;
2. `<application-root>/resources/admet/` when it contains model-family directories; then
3. `<application-root>/app_data/model_resources/admet/`.

The expected family directory names are:

```text
ChemBERTa/
GMC_MPNN_BBB/
Chemprop_regression/
```

The small versioned runners and `resources/admet/runtime_manifest.json` remain source resources. Release archives, production manifests, and checksum inventories must be transferred through the controlled release process and verified. Archive extraction is path-safe and SHA-256 checked; missing, incompatible, or corrupt resources fail closed.

The current production ChemBERTa family resolves from the verified `ChemBERTa` release archive described above. Separately, the legacy BBB cache diagnostics use `app_data/model_cache/huggingface` by default. Normal rendering does not download weights. Do not commit model caches, extracted release caches, unpublished data, or machine-specific paths.

The general staged runtime is built at `desktop/runtime/python/`. Isolated family runtimes are staged below `desktop/runtime/admet/`. `desktop/build/afterPack.js` copies the entire `desktop/runtime/` tree into packaged `resources/runtime/`.

## 11. Frontend Production Build

From the repository root:

```bat
cd frontend
npm.cmd run build
```

Vite writes the generated frontend to `frontend/dist/`. The Electron packaging scripts invoke this build automatically before packaging.

## 12. Electron Win-Unpacked Build

From the repository root:

```bat
cd desktop
npm.cmd install
npm.cmd run package
```

The `package` script runs the frontend build and then:

```text
electron-builder --win dir
```

The unpacked application is generated at `desktop/dist/win-unpacked/`. Ensure all intended general, family-specific, native, runner, and model release resources are staged and verified before treating this output as a release candidate.

## 13. NSIS-Web Release Build

From `desktop/`:

```bat
npm.cmd run dist
```

The `dist` script runs the frontend build and `electron-builder --win nsis-web`. The current qualified pair is stored together under `desktop/dist/nsis-web/`: the setup executable `MolOptima Web Setup 0.1.0.exe` and its external x64 package `moloptima-desktop-0.1.0-x64.nsis.7z`. These two release files must be distributed together.

The current builder configuration is per-user (`perMachine: false`), allows installation-directory selection, and disables executable signing/editing in the build configuration.

## 14. Generated Artifact Locations

Important generated locations include:

```text
frontend/dist/                         Vite production frontend
desktop/dist/win-unpacked/             unpacked Windows application
desktop/dist/nsis-web/                 external NSIS package
desktop/dist/nsis-web/                 setup executable, external package, and update metadata
desktop/runtime/                       locally staged bundled runtimes
backend/uploads/                       imported molecule files/manifests
backend/receptors/                     receptor artifacts and provenance
backend/job_outputs/                   job results and export packages
backend/job_metadata/                  persisted job metadata
app_data/model_cache/                  local model/extraction caches
app_data/public_lookup_cache/          optional public-source caches
```

These are generated or locally provisioned artifacts unless a specific existing tracked placeholder says otherwise. Do not use broad staging commands for release work.

## 15. Installed Release Architecture

The installed application is an Electron shell with a packaged React frontend and local FastAPI backend. Electron resolves and starts the bundled backend interpreter, waits for `/health`, and loads the built frontend from packaged resources. The UI calls the loopback backend on port 8000.

`desktop/package.json` packages application source/resources under `resources/moloptima-app/`, the Vite output under `resources/frontend-dist/`, and staged scientific runtimes under `resources/runtime/`. Versioned ADMET runners, manifests, prioritization profiles, receptor-preparation metadata, and native Vina/Open Babel resources are packaged through `extraResources` and the `afterPack` hook.

Scientific work and caches remain local. Normal shutdown asks Electron to terminate its backend child process. The qualified per-user executable is under `%LOCALAPPDATA%\Programs\MolOptima\MolOptima.exe`.

## 16. Development Mode Versus Installed Release Mode

### Development mode

- runs Electron from `desktop/`;
- normally starts Vite at `127.0.0.1:5173`;
- can use `MOLOPTIMA_FRONTEND_URL` or suppress Vite with `MOLOPTIMA_START_FRONTEND=0`;
- can resolve the backend Python from an override, staged runtime, or `PATH` fallback;
- uses source-tree modules and resources; and
- exposes development stderr/stdout and Electron diagnostics.

### Installed release mode

- loads the prebuilt frontend from packaged files unless a frontend URL is explicitly supplied;
- has no Python-on-`PATH` fallback;
- resolves the qualified bundled backend and family-specific scientific runtimes/resources;
- runs independently of the source checkout;
- uses the same local API and scientific workflow; and
- shuts down the launched backend during normal application exit.

Do not validate installed-release independence by relying on a source checkout or development environment override.

## 17. Basic Test Commands

Python tests, from the repository root:

```bat
python -m pytest -q
```

Frontend tests, from `frontend/`:

```bat
npm.cmd test
```

Electron lifecycle tests, from `desktop/`:

```bat
npm.cmd run test:lifecycle
```

Validate an already staged general desktop runtime, from the repository root:

```bat
scripts\check_desktop_runtime_windows.bat
```

To check imports without temporarily starting the backend:

```bat
scripts\check_desktop_runtime_windows.bat /skip-health
```

The check script verifies RDKit, FastAPI, Uvicorn, pandas, NumPy, Meeko `0.7.1`, Gemmi `0.7.5`, and `backend.main`; its ordinary mode also validates `/health`.

## 18. Packaging Qualification Commands

### Build and validate the general bundled runtime

The build script uses `MOLOPTIMA_CONDA_ENV`, defaulting to the maintainer's `molecule-intelligence` environment location. Set a public-safe local path when needed:

```bat
set MOLOPTIMA_CONDA_ENV=C:\path\to\conda-env
scripts\build_desktop_runtime_windows.bat
```

Supported script options are:

```bat
scripts\build_desktop_runtime_windows.bat /force
scripts\build_desktop_runtime_windows.bat /install-conda-pack
```

`/force` replaces an existing staged general runtime. `/install-conda-pack` authorizes the script to install `conda-pack` into the selected environment. Without that option, a missing `conda-pack` dependency causes a clear failure.

### Scientific release qualification

After staging the frozen model releases and isolated runtimes, the documented acceptance command is:

```bat
python scripts\qualify_packaged_scientific_runtime.py --output-dir qualification-output
```

The output directory must not already exist. This command executes real scientific runtime qualification and can run model predictions; use it only with approved release inputs and authorization. It was not run while preparing this guide.

Real Vina qualification additionally requires every receptor-specific input; the script does not synthesize a receptor, search box, or executable:

```bat
python scripts\qualify_packaged_scientific_runtime.py ^
  --output-dir qualification-output ^
  --receptor path\to\approved-receptor.pdbqt ^
  --center-x X --center-y Y --center-z Z ^
  --size-x SX --size-y SY --size-z SZ ^
  --exhaustiveness N --num-modes N --seed N ^
  --vina-executable path\to\vina.exe ^
  --obabel-executable path\to\obabel.exe
```

The harness writes `qualification_summary.json`, `qualification_predictions.json`, `runtime_provenance.json`, and `SHA256SUMS`. A real Vina qualification also writes `vina_acceptance.json` and retains pose hashes. Only real successful runtimes yield `PASS`; absent assets are `NOT_RUN`, and test doubles are identified as `MOCK_TESTED_ONLY`.

For release acceptance, also run the intended unpacked/installer smoke procedures against staged artifacts, confirm all Scientific Runtime cards, confirm clean normal shutdown, and preserve qualification evidence outside Git. No single script replaces the installed-app smoke qualification.
