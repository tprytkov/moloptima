# MolOptima Project Goal

## Project Name

**MolOptima**

## Main Goal

MolOptima is a modular scientific web platform for prioritizing AI-generated or user-provided small molecules and connecting the best candidates to broader biopharma intelligence.

The first version will focus on **post-generation evaluation**, not molecule generation inside the app. Generated molecules can come from an external model running on a GPU cluster, local scripts, or uploaded CSV/SDF files.

MolOptima should help answer:

- Which molecules are chemically valid and drug-like?
- Which molecules have favorable molecular descriptors and ADME/BBB properties?
- Which molecules show promising docking or binding-related signals?
- Which molecules are synthetically feasible?
- Which molecules are novel or similar to known public compounds?
- Which molecules have useful literature, patent, clinical, or biopharma context?

## Core Concept

MolOptima has two major modules:

1. **Molecular Prioritization**
2. **Biopharma Intelligence**

The platform should not be built as a simple one-model demo. It should be designed as a scientific decision-support system where multiple models and computational tools contribute to compound ranking and interpretation.

---

# Module 1: Molecular Prioritization

## Purpose

The Molecular Prioritization module ranks molecules based on computational chemistry, ADME, docking, and synthetic-feasibility signals.

## Input

The module should accept:

- SMILES strings
- CSV files with molecule identifiers and SMILES
- Optional SDF files later
- Output from an external generative model

## Main Capabilities

The module should include:

- SMILES validation
- Molecule standardization
- RDKit descriptors
- Drug-likeness filters
- QED score
- Lipinski / Veber-style rule checks
- TPSA, MW, HBA, HBD, rotatable bonds
- BBB / ADME model predictions
- Docking score integration
- Synthetic accessibility scoring
- Optional retrosynthesis model integration
- Composite prioritization score
- Ranked molecule table
- Exportable CSV results

## Reusable Code from Existing BERT App

The existing BERT app code should be reused where possible for:

- SMILES input handling
- CSV loading
- RDKit descriptor calculation
- ChemBERTa / BBB model inference
- Hugging Face model loading and local cache handling
- Prediction table generation
- Basic scoring logic
- CSV export
- Existing tests and benchmark logic

The old Streamlit UI can be used as a reference, but the new platform should separate model logic from UI logic.

---

# Module 2: Biopharma Intelligence

## Purpose

The Biopharma Intelligence module connects prioritized molecules to external scientific, clinical, patent, and translational context.

This module does not claim that a new molecule has clinical efficacy. Instead, it provides clinical and biopharma context based on target, mechanism, similarity to known compounds, literature evidence, patent signals, and disease-area mapping.

## Main Capabilities

The module should include:

- Chemical identity check
- PubChem / ChEMBL-style exact match logic
- Similarity to known compounds
- Chemical-space analysis
- Patent similarity or patent evidence signal
- BioBERT / ClinicalBERT literature evidence extraction
- Disease / target / mechanism mapping
- Clinical-trial context extraction
- OMOP-style clinical concept mapping
- Compound-level biopharma report generation

## Example Clinical Context Mapping

For Alzheimer’s-related molecules, the module may map molecular or target-level information to clinical concepts such as:

- Alzheimer’s disease
- Mild cognitive impairment
- Dementia
- MMSE
- MoCA
- ADAS-Cog
- Amyloid PET
- Tau PET
- CSF Aß42
- Donepezil
- Rivastigmine
- Memantine

This should be framed as clinical-context mapping, not direct clinical outcome prediction.

---

# Initial Architecture

The first version should avoid unnecessary infrastructure complexity.

## Core Architecture

```text
React / MUI dashboard
        ?
FastAPI backend
        ?
Python molecular pipelines
        ?
Optional Redis/RQ worker system
        ?
Local machine or GPU-cluster worker
        ?
SQLite/PostgreSQL + result files