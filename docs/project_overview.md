# MolOptima Project Overview

MolOptima is a local compound prioritization and biopharma intelligence platform for analyzing generated or user-provided molecules. It is structured as a modular full-stack system that combines Python/RDKit cheminformatics, a FastAPI backend, a React/MUI frontend, model-cache transparency, and report export without using private data or cloud services.

## System Walkthrough

1. Start the backend with `python -m uvicorn backend.main:app --reload`.
2. Start the frontend with `npm.cmd run dev` from `frontend/`.
3. Upload `data/demo_inputs/demo_molecules.csv` or another CSV with `molecule_id` and `smiles`.
4. Run prioritization.
5. Review Dashboard, Molecular Prioritization, Biopharma Intelligence, Reports, and Settings.
6. Download a compound Markdown report from Compound Detail or Reports.

## What Is Implemented

- RDKit validation, canonicalization, descriptors, QED, and Lipinski-style fields.
- Transparent first-pass priority scoring.
- Offline known-compound exact identity and closest-reference similarity.
- Optional cached BBB/ChemBERTa status and inference.
- Input-only docking score preservation.
- Informational synthetic feasibility fields.
- Latest-run dashboard and biopharma summaries.
- Markdown compound report export.
- Local model/data-source manifest visibility.

## Architecture Snapshot

```text
React/MUI frontend
  -> FastAPI backend
    -> molecular_prioritization pipeline
    -> biopharma_intelligence local reference checks
    -> local files: uploads, outputs, metadata, app_data manifests
```

## Screenshot Assets

Screenshots used by the README live in:

```text
docs/screenshots/
```

Current set:

- `dashboard.png`
- `compound-detail.png`
- `biopharma.png`
- `reports.png`
- `settings.png`

## Verification Commands

```bat
python -m pytest
cd frontend
npm.cmd run build
```

## Disclaimer

MolOptima is a computational screening application. It does not provide clinical, legal, regulatory, patentability, safety, efficacy, or freedom-to-operate conclusions.
