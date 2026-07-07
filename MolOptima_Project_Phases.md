# MolOptima Development Phases

Implementation roadmap for a modular compound prioritization and biopharma intelligence platform.

Version 1 focus: local/GPU-cluster execution with FastAPI + React/MUI; no required Databricks or MLflow.

## Purpose

This document describes the recommended development phases for MolOptima. The goal is to build a practical project that starts from the existing BERT/ChemBERTa molecule app, refactors reusable scientific logic, and grows into a two-module platform: Molecular Prioritization and Biopharma Intelligence.

The first version should prioritize reliable local or cluster execution. Databricks, MLflow, AWS, and other cloud components should remain optional portfolio extensions rather than requirements for the core system.

## High-Level Phase Order

- Phase 0 — Project Setup and Extraction from Existing BERT App
- Phase 1 — Core Molecular Prioritization CLI
- Phase 2 — BBB / ADME Model Integration
- Phase 3 — FastAPI Backend
- Phase 4 — React / MUI Dashboard
- Phase 5 — Docking and Synthetic Feasibility
- Phase 6 — Biopharma Intelligence Foundation
- Phase 7 — Clinical Context and OMOP-Style Mapping
- Phase 8 — Compound Reports and App Polish
- Phase 9 — Optional Cluster Worker System
- Phase 10 — Optional Cloud / Portfolio Extension

## Detailed Phase Descriptions

## Phase 0 — Project Setup and Extraction from Existing BERT App

**Goal:** Create the new MolOptima project folder and move reusable scientific logic out of the old Streamlit/BERT app into clean Python modules.

**Key deliverables:**
- Create C:\MolOptima with README.md, PROJECT_GOAL.md, docs/, tests/, data/, outputs/, backend/, frontend/, molecular_prioritization/, and biopharma_intelligence/ folders.
- Copy or refactor reusable BERT app functions into standalone modules: SMILES validation, RDKit descriptors, BBB/ChemBERTa inference, model-cache loading, scoring, and CSV export.
- Create a small demo input CSV with molecule_id and smiles columns.
- Add a simple test suite that confirms the demo input can be loaded and standardized.

**Success criterion:** The project can be opened by Codex as an independent repository, and the old BERT logic is no longer tied to Streamlit UI code.

**Avoid in this phase:** Do not build React, Databricks, MLflow, docking, patents, or OMOP in this phase.

## Phase 1 — Core Molecular Prioritization CLI

**Goal:** Build a command-line pipeline that takes a CSV of SMILES and produces a ranked molecule table.

**Key deliverables:**
- Implement a CLI command such as: python -m molecular_prioritization.run --input data/demo_inputs/molecules.csv --output outputs/ranked_results/results.csv.
- Validate and standardize SMILES with RDKit.
- Calculate core descriptors: MW, TPSA, HBA, HBD, rotatable bonds, logP, QED, Lipinski/Veber-style flags, and optional PAINS/Brenk alerts.
- Produce a clean CSV containing molecule_id, canonical_smiles, validity flags, descriptors, and a first-pass priority_score.

**Success criterion:** One command runs from start to finish and produces a ranked CSV without any web interface.

**Avoid in this phase:** Do not start with frontend code. Prove the scientific pipeline works first.

## Phase 2 — BBB / ADME Model Integration

**Goal:** Add the existing ChemBERTa/BBB model and additional ADME-style outputs to the prioritization pipeline.

**Key deliverables:**
- Reuse local Hugging Face cache handling from the BERT app.
- Add BBB prediction columns, such as bbb_probability, bbb_label, and model_status.
- Add simple ADME-style rule-based or model-based flags where available.
- Update the composite priority_score to combine descriptors, BBB/ADME signals, and validity filters.
- Add tests for model-loading fallback behavior and offline/local-cache behavior.

**Success criterion:** The pipeline produces a chemically interpretable ranked table that includes descriptors plus BBB/ADME predictions.

**Avoid in this phase:** Do not store large model weights in GitHub. Keep them in C:\BERT\app_data\model_cache, C:\MolOptima\app_data\model_cache, or a cluster model directory.

## Phase 3 — FastAPI Backend

**Goal:** Wrap the molecular prioritization pipeline with a clean API so the future dashboard can call it.

**Key deliverables:**
- Create backend/app/main.py with FastAPI.
- Add endpoints for upload, run prioritization, check job status, and retrieve results.
- Use local file storage or SQLite for early job metadata.
- Return structured JSON summaries and downloadable result file paths.
- Add API tests with small demo molecules.

**Success criterion:** A user or frontend can submit a molecule CSV through FastAPI and retrieve a ranked result table.

**Avoid in this phase:** Do not use Databricks or MLflow here. FastAPI is the core backend for Version 1.

## Phase 4 — React / MUI Dashboard

**Goal:** Create a predictable scientific dashboard that exposes the pipeline through a clean user interface.

**Key deliverables:**
- Create a React + MUI application shell with sidebar navigation.
- Add pages for Dashboard, Upload Molecules, Molecular Prioritization, Biopharma Intelligence, Reports, and Settings.
- Implement upload form, job-status view, ranked-results table, molecule-detail panel, and report-download placeholder.
- Connect the dashboard to FastAPI endpoints using placeholder/demo results first, then real results.

**Success criterion:** The user can upload molecules from the dashboard, run the pipeline, and inspect ranked results in a table.

**Avoid in this phase:** Do not make a marketing website. Use an application-shell/dashboard structure.

## Phase 5 — Docking and Synthetic Feasibility

**Goal:** Extend molecular prioritization beyond descriptors and BBB/ADME by adding docking and synthesizability signals.

**Key deliverables:**
- Create a docking wrapper that can read precomputed docking scores first, then later run docking jobs if needed.
- Add docking_score and docking_rank fields to the output table.
- Add synthetic accessibility score, retrosynthetic accessibility score, or ReactionT5-style retrosynthesis output when available.
- Update priority_score to combine molecular quality, BBB/ADME, docking, and synthetic feasibility.
- Document when scores are predicted, precomputed, or missing.

**Success criterion:** MolOptima can rank molecules using multiple scientific criteria, not only BBB prediction.

**Avoid in this phase:** Do not force full docking or retrosynthesis for every molecule in the first implementation. Start with precomputed or optional scores.

## Phase 6 — Biopharma Intelligence Foundation

**Goal:** Create the second major module, focused on context rather than molecular scoring.

**Key deliverables:**
- Add chemical identity checks using exact-match logic against reference datasets or public lookup outputs.
- Add similarity-to-known-compounds using Morgan fingerprints and Tanimoto similarity.
- Add chemical-space analysis outputs such as nearest reference compound, cluster label, or projection coordinates.
- Add literature evidence stubs that can later use BioBERT/ClinicalBERT or PubMed-derived text.
- Add patent-evidence stubs or similarity-to-patent-reference logic.

**Success criterion:** Top molecules receive a context summary: known/novel signal, closest known compound, chemical-space relationship, and initial evidence fields.

**Avoid in this phase:** Do not claim legal freedom-to-operate or clinical efficacy. Use language such as patent signal, novelty signal, and clinical context.

## Phase 7 — Clinical Context and OMOP-Style Mapping

**Goal:** Connect prioritized molecules to clinical and RWE-style concepts through target, disease area, endpoint, medication, and biomarker mappings.

**Key deliverables:**
- Create an OMOP-style mapping table for Alzheimer’s disease concepts: condition, measurement, drug exposure, biomarker, and outcome categories.
- Map Alzheimer’s concepts such as MCI, dementia, MMSE, MoCA, ADAS-Cog, amyloid PET, tau PET, CSF Aβ42, donepezil, rivastigmine, and memantine.
- Add a clinical_context.py module that converts target/disease/mechanism information into structured clinical-context fields.
- Optionally add ClinicalBERT/BioBERT extraction later for clinical-trial descriptions or literature snippets.
- Generate a clinical-context section for the compound report.

**Success criterion:** MolOptima can explain how a new molecule may fit a disease area or development context without claiming patient-level efficacy.

**Avoid in this phase:** Do not use OMOP models directly on SMILES. OMOP belongs to clinical/RWE data, not molecular structure input.

## Phase 8 — Compound Reports and App Polish

**Goal:** Turn ranked outputs and evidence fields into readable compound-level reports.

**Key deliverables:**
- Create a report generator that writes Markdown and/or DOCX reports for selected compounds.
- Include molecular descriptors, BBB/ADME predictions, docking/synthesis signals, identity/similarity evidence, literature/patent notes, and clinical-context mapping.
- Add report download buttons in the dashboard.
- Add clear warnings about predicted results and limitations.
- Improve README, screenshots, example outputs, and project documentation.

**Success criterion:** A user can select a top molecule and download a scientifically structured report.

**Avoid in this phase:** Do not overstate predictions. Reports should support prioritization decisions, not make clinical claims.

## Phase 9 — Optional Cluster Worker System

**Goal:** Add background workers only when jobs become too slow for direct FastAPI execution.

**Key deliverables:**
- Add Redis + RQ or Celery for job submission and background execution.
- Run worker processes on the GPU cluster or local workstation.
- Store job status, logs, output paths, and error messages.
- Separate CPU steps from GPU-heavy steps where practical.
- Add dashboard status updates for queued, running, completed, and failed jobs.

**Success criterion:** Longer jobs can run without blocking the API or frontend.

**Avoid in this phase:** Do not use Slurm if the cluster does not have Slurm. Do not expose the GPU cluster directly as a public web server.

## Phase 10 — Optional Cloud / Portfolio Extension

**Goal:** Demonstrate AWS or Databricks awareness without making the project depend on paid infrastructure.

**Key deliverables:**
- Add an optional cloud_demo/ folder with small AWS-style storage or Databricks-notebook examples.
- Create a Databricks Free Edition notebook that loads a small ranked-results CSV into a Delta-style analytics table, if feasible.
- Create an AWS/S3-style demo that uploads or reads small result files, if feasible within free-tier limits.
- Document the cloud architecture as optional, not required.

**Success criterion:** The GitHub project demonstrates cloud readiness while the main app remains runnable locally or on the cluster.

**Avoid in this phase:** Do not move large model inference, docking, BioBERT, ReactionT5, or the generative model to paid cloud compute in the first version.

## Reuse vs. Build from Scratch

| Component | Decision | Notes |
|---|---|---|
| Existing BERT app code \| Reuse/refactor \| SMILES input, RDKit descriptors, ChemBERTa/BBB inference, model-cache logic, prediction tables, CSV export, benchmark tests. |
| React/MUI dashboard \| Create new \| The old Streamlit UI can guide behavior, but React frontend code should be new. |
| FastAPI backend \| Create new \| Needed to separate web API from scientific pipeline logic. |
| Docking integration \| Mostly new \| Start with precomputed docking scores; add full job execution later. |
| Retrosynthesis/synthetic feasibility \| New \| Add SA score first; add ReactionT5/RAscore/AiZynthFinder later if practical. |
| Biopharma Intelligence \| Mostly new \| Identity, chemical space, literature, patent, clinical context, OMOP-style mapping, reports. |
| Databricks/MLflow \| Not required \| Optional future cloud/enterprise extension only. Not part of Version 1. |

## First Milestone

The first successful milestone is a command-line or FastAPI-driven workflow where a user provides a CSV of SMILES and MolOptima validates the molecules, calculates RDKit descriptors, runs the BBB/ADME model, computes a composite prioritization score, and returns a ranked CSV/table.

This milestone should be completed before adding docking, patents, OMOP-style clinical mapping, cloud demos, or a full dashboard.

## Recommended Codex Rule

Give Codex one phase at a time. Do not ask Codex to build the entire platform in one prompt. Each phase should produce runnable code, tests, and a clear git status before moving to the next phase.
