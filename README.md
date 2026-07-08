# MolOptima

MolOptima is a Python-first scientific project for prioritizing small molecules after they have been generated or supplied by a user.

This repository currently focuses on Phase 1: core molecular prioritization logic, a minimal local FastAPI backend, and a React/MUI dashboard for uploading molecule CSVs and running prioritization jobs. It intentionally does not include docking, patents, OMOP, Databricks, MLflow, Redis, Docker, cloud services, or downloaded model weights.

## Current Scope

- Validate and canonicalize SMILES input with RDKit.
- Calculate Phase 1 RDKit descriptors and Lipinski-style flags.
- Rank molecules with a simple, transparent first-pass score.
- Add informational heuristic synthetic accessibility fields without changing the priority score.
- Optionally add cached ChemBERTa BBB predictions when local model files are available.

## Project Structure

```text
molecular_prioritization/
  __init__.py
  standardize.py
  descriptors.py
  prioritization.py
  pipeline.py
  bbb_predictor.py
backend/
  main.py
  schemas.py
  services.py
frontend/
  src/
  package.json
data/
  demo_inputs/
outputs/
  ranked_results/
app_data/
  model_cache/
    huggingface/
  public_lookup_cache/
  manifests/
tests/
docs/
```

## Run Full-Stack App Locally

Use the conda environment that has RDKit, FastAPI, pytest, and the backend dependencies installed.

From Anaconda Prompt:

```bat
conda activate molecule-intelligence
cd MolOptima
```

Start the FastAPI backend from the repository root:

```bat
uvicorn backend.main:app --reload
```

In a second Anaconda Prompt, start the React/Vite frontend:

```bat
cd MolOptima
cd frontend
npm.cmd install
npm.cmd run dev
```

Open the Vite URL shown in the terminal, typically:

```text
http://127.0.0.1:5173/
```

The frontend calls the backend at `http://localhost:8000`. The backend must be running before the upload/prioritization workflow will work.

Run backend tests from the repository root:

```bat
conda activate molecule-intelligence
cd MolOptima
python -m pytest
```

Run the frontend production build:

```bat
cd MolOptima
cd frontend
npm.cmd run build
```

## Current Capabilities

- Upload a molecule CSV with `molecule_id` and `smiles` columns through the React/MUI frontend.
- Store uploaded CSVs locally under `backend/uploads/`.
- Start a synchronous Phase 1 prioritization job through the FastAPI backend.
- Validate and canonicalize SMILES with RDKit.
- Calculate basic descriptors, Lipinski-style flags, QED, BBB columns, heuristic synthetic accessibility fields, and `priority_score`.
- Fetch job results from `GET /api/results/{job_id}`.
- Display job status, row count, output path, and a small preview table in the frontend.
- Persist local JSON job metadata under `backend/job_metadata/`.
- Show model and public-data source status in the Settings page.
- Write app-managed model, public-data, and run manifests under `app_data/manifests/`.

## Not Yet Implemented

- Docking or binding-score workflows.
- BBB/ChemBERTa as a required model dependency. The BBB step is optional and uses local cached model files only when available.
- Retrosynthesis or synthetic-accessibility model integration beyond the current transparent heuristic.
- Patent search, patent similarity, or freedom-to-operate analysis.
- OMOP, clinical context, clinical-trial mapping, or patient-level clinical/RWE workflows.
- Redis/RQ, Celery, or any background worker queue.
- Cloud, Databricks, AWS, Docker, MLflow, or managed deployment features.

## Development Commands

Run all Python tests from the repository root:

```bash
python -m pytest
```

Run the demo pipeline:

```bash
python -m molecular_prioritization.pipeline --input data/demo_inputs/demo_molecules.csv --output outputs/ranked_results/demo_ranked.csv
```

Run the local API:

```bash
uvicorn backend.main:app --reload
```

Run the frontend dashboard from `frontend/`:

```bash
cd frontend
npm.cmd install
npm.cmd run dev
```

The frontend includes pages for uploading a molecule CSV and starting a Phase 1 prioritization job against the local FastAPI backend. Start the backend first with `uvicorn backend.main:app --reload`, then open the Vite URL shown by `npm.cmd run dev`.

Build the frontend:

```bash
cd frontend
npm.cmd run build
```

The API exposes `GET /health`, `POST /api/molecules/upload`, `POST /api/jobs/prioritization`, and `GET /api/results/{job_id}`. Uploaded CSVs, ranked result files, and JSON job metadata are stored locally under `backend/`.

Runtime files are intentionally ignored by Git:

- `backend/uploads/`
- `backend/job_outputs/`
- `backend/job_metadata/`
- `outputs/ranked_results/`
- `app_data/model_cache/`
- `app_data/public_lookup_cache/`

Each runtime folder keeps a `.gitkeep` placeholder so the folder structure is available after cloning.

## API Usage

Start the server:

```bash
uvicorn backend.main:app --reload
```

Check health:

```bash
curl http://127.0.0.1:8000/health
```

Upload a molecule CSV:

```bash
curl -X POST http://127.0.0.1:8000/api/molecules/upload \
  -F "file=@data/demo_inputs/demo_molecules.csv"
```

The upload response includes an `upload_id`. Use that value to run prioritization:

```bash
curl -X POST http://127.0.0.1:8000/api/jobs/prioritization \
  -H "Content-Type: application/json" \
  -d "{\"upload_id\":\"PASTE_UPLOAD_ID_HERE\"}"
```

The job response includes a `job_id`. Retrieve results with:

```bash
curl http://127.0.0.1:8000/api/results/PASTE_JOB_ID_HERE
```

Python example:

```python
import requests

base_url = "http://127.0.0.1:8000"

with open("data/demo_inputs/demo_molecules.csv", "rb") as handle:
    upload = requests.post(
        f"{base_url}/api/molecules/upload",
        files={"file": ("demo_molecules.csv", handle, "text/csv")},
        timeout=30,
    )
upload.raise_for_status()
upload_id = upload.json()["upload_id"]

job = requests.post(
    f"{base_url}/api/jobs/prioritization",
    json={"upload_id": upload_id},
    timeout=120,
)
job.raise_for_status()
job_id = job.json()["job_id"]

results = requests.get(f"{base_url}/api/results/{job_id}", timeout=30)
results.raise_for_status()
print(results.json()["results"])
```

BBB prediction is optional and offline-first. By default MolOptima checks the app-managed Hugging Face cache root `app_data/model_cache/huggingface` for `Yousuf7/ChemBERT-BBB-Permeability`. If the model is unavailable, the output still includes `bbb_prediction`, `bbb_probability`, `bbb_model_status`, and `bbb_warning` columns without crashing.

To point at a local cache, set `MOLOPTIMA_BBB_MODEL_CACHE`. MolOptima does not download model files automatically unless `MOLOPTIMA_ALLOW_MODEL_DOWNLOAD=1` is explicitly set.

Synthetic accessibility is currently informational. MolOptima writes `sa_score`, `synthetic_feasibility_category`, and `synthetic_feasibility_status` using a transparent RDKit-based `heuristic_synthetic_accessibility` calculation. It is not a retrosynthesis model and does not change `priority_score`.

## Model and Data Sources

MolOptima uses an app-managed cache by default:

```text
app_data/model_cache/huggingface
```

To check whether the BBB/ChemBERTa model is cached, look for:

```text
app_data/model_cache/huggingface/models--Yousuf7--ChemBERT-BBB-Permeability
```

The Settings page includes a Model and Data Sources section with explicit buttons for:

- Check local model cache
- Refresh source status

Normal rendering does not download large model files. Set `MOLOPTIMA_ALLOW_MODEL_DOWNLOAD=1` only when you intentionally want model download behavior from the Python loader.

Manifests are stored in:

- `app_data/manifests/model_manifest.json`
- `app_data/manifests/public_data_manifest.json`
- `app_data/manifests/run_manifest.json`

The public-data manifest currently records PubChem, ChEMBL, and SureChEMBL as planned inactive sources.

## Troubleshooting

### PowerShell blocks npm.ps1

On this Windows machine, PowerShell may reject `npm` with a script execution policy error. Use `npm.cmd` instead:

```bat
cd MolOptima
cd frontend
npm.cmd install
npm.cmd run dev
npm.cmd run build
```

### Backend must run before frontend workflow

The frontend can load without the backend, but upload and prioritization requests require FastAPI to be running:

```bat
conda activate molecule-intelligence
cd MolOptima
uvicorn backend.main:app --reload
```

Check backend health:

```bat
curl http://127.0.0.1:8000/health
```

Expected response:

```json
{"status":"ok","service":"moloptima-backend"}
```

### CORS localhost configuration

The backend currently allows local Vite origins:

- `http://localhost:5173`
- `http://127.0.0.1:5173`

If the frontend runs on a different port, update the local CORS origins in `backend/main.py` or run Vite on port `5173`.
