# MolOptima

MolOptima is a Python-first scientific project for prioritizing small molecules after they have been generated or supplied by a user.

This repository currently focuses on Phase 1: core molecular prioritization logic and a minimal local FastAPI backend. It intentionally does not include React, docking, patents, OMOP, Databricks, MLflow, Redis, Docker, cloud services, or downloaded model weights.

## Current Scope

- Validate and canonicalize SMILES input with RDKit.
- Calculate Phase 1 RDKit descriptors and Lipinski-style flags.
- Rank molecules with a simple, transparent first-pass score.
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
data/
  demo_inputs/
outputs/
  ranked_results/
tests/
docs/
```

## Development

Use the conda environment that has RDKit, FastAPI, and pytest installed. From the repository root, run tests with:

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

The API exposes `GET /health`, `POST /api/molecules/upload`, `POST /api/jobs/prioritization`, and `GET /api/results/{job_id}`. Uploaded CSVs, ranked result files, and JSON job metadata are stored locally under `backend/`.

Runtime files are intentionally ignored by Git:

- `backend/uploads/`
- `backend/job_outputs/`
- `backend/job_metadata/`
- `outputs/ranked_results/`

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

BBB prediction is optional and offline-first. By default MolOptima checks local Hugging Face cache roots such as `app_data/model_cache/huggingface` and the previous BERT app cache for `Yousuf7/ChemBERT-BBB-Permeability`. If the model is unavailable, the output still includes `bbb_prediction`, `bbb_probability`, `bbb_model_status`, and `bbb_warning` columns without crashing.

To point at a local cache, set `MOLOPTIMA_BBB_MODEL_CACHE`. MolOptima does not download model files automatically unless `MOLOPTIMA_ALLOW_MODEL_DOWNLOAD=1` is explicitly set.
