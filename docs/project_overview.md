# MolOptima Project Overview

MolOptima is a local compound prioritization and biopharma intelligence application for analyzing generated or user-provided molecules. It combines Python/RDKit cheminformatics, a FastAPI backend, a React/MUI frontend, app-managed model and public-lookup caches, local run history, candidate review annotations, and export tools without requiring cloud services.

## System Walkthrough

1. Start the backend with `python -m uvicorn backend.main:app --reload`.
2. Start the frontend with `npm.cmd run dev` from `frontend/`.
3. Upload `data/demo_inputs/demo_molecules.csv` or another CSV with `molecule_id` and `smiles`. Include an optional `docking_score` column only when docking scores were generated outside MolOptima.
4. Run prioritization, optionally enabling PubChem exact identity, ChEMBL bioactivity context, and SureChEMBL patent-context lookups.
5. Review Dashboard, Molecular Prioritization, Run History, Run Comparison, Chemical Space, Biopharma Intelligence, Reports, and Settings.
6. Inspect compound details, 2D structure previews, evidence summaries, docking-informed fields, structural alerts, diversity clusters, and chemical-space position.
7. Annotate candidates with local review status and notes.
8. Export filtered CSVs, Markdown reports, candidate handoff packages, or SDF files.

## What Is Implemented

- RDKit validation, canonicalization, descriptors, QED, and Lipinski-style fields.
- Transparent first-pass priority scoring.
- Offline known-compound exact identity and closest-reference similarity.
- Heuristic synthetic accessibility fields.
- Optional cached BBB/ChemBERTa inference using the app-managed Hugging Face cache.
- Optional docking score input preservation.
- Optional docking-informed combined candidate score calculated from uploaded numeric `docking_score` values. More negative docking scores receive stronger normalized signals within the current run, and the combined score remains separate from `priority_score`.
- Optional PubChem exact identity lookup with local result caching.
- Optional ChEMBL public bioactivity context with local result caching.
- Optional SureChEMBL public patent-context signals with local result caching. Returned record counts may include broad or indirect public document associations for the structure/query.
- Deterministic evidence synthesis across local identity, local similarity, PubChem, ChEMBL, and SureChEMBL fields.
- RDKit medicinal chemistry structural-alert screening with PAINS and Brenk catalogs where available.
- RDKit fingerprint-based diversity clustering, nearest-neighbor similarity, cluster sizes, and representative flags.
- Deterministic chemical-space coordinates and frontend chemical-space visualization.
- RDKit 2D structure preview generated from canonical or input SMILES.
- Latest-run dashboard, biopharma, reports, and chemical-space summaries.
- Run History for completed analyses and Run Comparison for two saved runs.
- Candidate review queue with per-job status and review notes stored locally.
- CSV, Markdown, and SDF export for filtered results and selected/watchlist candidate packages.
- Local model/data-source manifest visibility.

## Architecture Snapshot

```text
React/MUI frontend
  -> FastAPI backend
    -> molecular_prioritization pipeline
    -> biopharma_intelligence local reference checks and optional PubChem/ChEMBL/SureChEMBL lookup
    -> RDKit descriptors, synthetic accessibility, structural alerts, diversity, chemical-space, and 2D structure rendering
    -> local files: uploads, outputs, metadata, annotations, app_data manifests, and lookup caches
```

## Key Output Groups

- Molecular descriptors: molecular weight, TPSA, HBA, HBD, rotatable bonds, QED, Lipinski violations, and Lipinski pass/fail.
- BBB fields: prediction, probability, model status, model warning, and model/source manifest status when the local ChemBERTa cache is available.
- Docking fields: uploaded `docking_score`, docking status, normalized docking signal, rank, percentile, docking priority signal, separate `combined_candidate_score`, and explanation/status fields.
- Public context: PubChem exact identity, ChEMBL public bioactivity context, and SureChEMBL patent-context signal when optional lookups are enabled.
- Evidence interpretation: evidence summary category, notes, identity signal, bioactivity signal, patent-context signal, local similarity signal, biopharma context level, and recommended review focus.
- Medicinal chemistry alerts: structural-alert status/count/categories/names, PAINS alert, Brenk alert, and screening summary.
- Diversity and visualization: diversity cluster ID, cluster size, representative flag, nearest neighbor, nearest-neighbor similarity, and chemical-space coordinates/status.
- Review and export: review status, review note, filtered CSV export, compound Markdown report, candidate Markdown handoff, and SDF export with key MolOptima properties.

## Limitations

- MolOptima does not run docking, prepare receptors, define binding sites, or execute AutoDock/Vina-style workflows.
- Docking-informed scoring depends on uploaded, externally generated, protocol-dependent docking scores. It does not confirm binding, efficacy, selectivity, safety, or clinical value.
- Public lookups are optional API calls with local caching. Missing public lookup fields mean the lookup may not have been requested, not necessarily that no public evidence exists.
- Structural alerts are heuristic screening signals. PAINS or Brenk matches do not prove toxicity, assay interference, lack of developability, clinical failure, or experimental unsuitability.
- SureChEMBL patent-context output is public-database context only. It is not a legal conclusion and does not assess patentability, infringement, ownership, or freedom to operate.
- All outputs are computational screening signals that require independent scientific review and experimental validation before downstream decisions.

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

MolOptima is a computational screening application. It provides descriptor, model, public-database, structural-alert, docking-informed, diversity, and review-workflow signals only. It does not provide clinical, legal, regulatory, safety, efficacy, ownership, or commercialization conclusions.
