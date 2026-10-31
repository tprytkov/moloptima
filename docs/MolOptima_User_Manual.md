# MolOptima User Manual

**Desktop environment for computational molecular evaluation and prioritization**

This manual describes the current MolOptima Windows desktop application. It is written for students, instructors, and researchers. MolOptima organizes computational predictions, structural analysis, scientific evidence, and review tools in one traceable workflow. It does not replace experimental testing, medicinal-chemistry judgment, safety assessment, or clinical decision-making.

## 1. Introduction

MolOptima is an integrated desktop environment for evaluating an individual small molecule or prioritizing a molecular library. Depending on the project and available inputs, it can bring together:

- molecular structures, validation, canonical identity, and provenance;
- receptor preparation, docking configuration, and AutoDock Vina results;
- a fixed panel of ADMET predictions;
- molecular similarity, scaffold, pharmacophore, and interaction context;
- matched molecular pair and experimental evidence context;
- configurable prioritization and ranking explanations;
- Pareto and sensitivity analysis; and
- reproducible result packages, manifests, and hashes.

Every layer has a different scientific meaning. A model prediction is not an experimental measurement. Structural similarity is not biological equivalence. A docking score is not measured binding affinity. A ranking supports decisions but does not identify an objectively best compound.

### 1.1 Intended audiences

Students can use this manual to learn the workflow and the scientific distinctions behind each display. Researchers and instructors can use the same sections for exact units, provenance, status definitions, limitations, and reproducibility guidance.

### 1.2 Documentation hierarchy

- **Context Help** gives a concise definition beside a scientific control or result.
- **Module Help** explains the current workspace and its main interpretation boundaries.
- **Central Help** is the searchable in-app reference available from **Help**.
- **User Manual** is this comprehensive, structured, printable, offline document.

The manual expands the in-app guidance without changing its terminology or scientific meaning.

## 2. Getting Started

### 2.1 System and installation

The Windows desktop release contains bundled scientific runtimes. Ordinary users do not need to install Python, Conda, RDKit, or CUDA separately. Release-specific system requirements should be taken from the accompanying release notes because no universal minimum hardware specification is asserted here.

The current `nsis-web` distribution contains a **MolOptima Web Setup** executable and its matching external x64 package. Keep both files together during installation. Launch the installed application from its Desktop or Start Menu shortcut; the source repository is not required.

### 2.2 Start-up

MolOptima starts its local scientific backend automatically. The application status bar reports **Backend connected**, **Checking backend connection**, or **Backend unavailable**. Allow the local services to initialize before starting calculation work.

On first use, open **Settings** and inspect **Scientific Runtime**. Runtime availability checks are diagnostics; they do not run predictions for a molecule.

### 2.3 Beginner workflow

A typical project can follow this sequence:

1. Import molecules and inspect validity, warnings, identity, and provenance.
2. Configure a receptor and docking setup when docking is relevant.
3. Run the calculations required for the project.
4. Inspect the fixed ADMET predictions and their status.
5. Explore ADMET profiles, heat maps, distributions, relationships, and comparisons.
6. Explore Chemical Space when structural relationships matter.
7. Inspect independent Design Logic evidence when docking and comparison artifacts are available.
8. Configure and run the appropriate Prioritization method for a library.
9. Review persisted Results and provenance.
10. Explore Pareto or Sensitivity Analysis when those questions are relevant.
11. Inspect imported, calculation-owned, or external Experimental Data.

Not every project requires every module. For example, a property-only calculation does not require a receptor, and a single-compound assessment does not produce a library rank or Pareto front.

## 3. MolOptima Scientific Workflow

### 3.1 Active and historical calculations

The **Workspace** summary represents the deliberately active calculation. A recently completed calculation can exist in history without becoming active automatically. **New Calculation** starts a fresh transient workflow. **Open Previous Calculation** deliberately loads a saved calculation for review.

**No active calculation** means that no calculation is currently selected for the scientific workspaces. It does not mean saved results were deleted.

Starting a new calculation clears current transient input, configuration, selection, and job state. It does not silently delete historical job files, exports, cached runtime resources, or installed scientific runtimes.

### 3.2 Status meanings

| Status | Meaning |
|---|---|
| Available | A result or qualified runtime is present for the stated context. |
| Missing | An expected value is absent. Missing is not numeric zero. |
| Not run | The calculation was not requested. |
| Not used | The method or configuration did not use that evidence. |
| Failed | Execution was attempted but did not produce that result. |
| Unavailable | The component or result cannot currently be used. |
| Results Need Recalculation | Scientific setup changed after the displayed result was produced. |

Filtering, sorting, selecting, opening Help, and opening this manual change only the view or inspection state. They do not recalculate scientific results.

## 4. Application Navigation

Selecting the MolOptima logo opens the **Workspace** summary. The current primary navigation is:

### Workspace

- Molecules
- Experimental Data
- Receptor & Docking
- ADMET
- Chemical Space
- Design Logic
- Prioritization
- Results
- Analysis

### System

- Settings
- Help

The header provides **New Calculation** and, where applicable, module-specific **Help**. The status bar identifies backend availability, the active calculation status, and active molecule count.

## 5. Molecules

### 5.1 Supported input

MolOptima accepts one or more SMILES records, CSV/TSV tables, individual SDF files, and ligand PDB files under the constraints shown in the interface. Tables use a `smiles` or `canonical_smiles` structure column. When more than one plausible column exists, specify the intended column rather than relying on a guess.

Multi-record SDF files are not accepted as a library input. Use multiple single-record SDF files. SDF is preferred over ligand PDB for small molecules because it preserves bond orders and formal charges more reliably. PDB reconstruction is conservative and fails closed when connectivity or chemistry is ambiguous.

### 5.2 Validation and identity

Select **Validate and load molecules** to create the active validated collection. The summary distinguishes submitted, valid, invalid, unresolved PDB, duplicate, and ignored records.

- **Valid** means the implemented chemical checks passed.
- **Valid with warning** remains valid, but the warning must be reviewed.
- **Invalid** means the record cannot enter scientific calculation.

Warnings are available from keyboard-reachable warning controls. They are not silently discarded. The preview preserves molecule ID, canonical SMILES, source file/record information, coordinate context, and a compact structure display where available.

Canonical identity supports consistent downstream processing, while source identity and original coordinates remain provenance. Duplicate display names must not be assumed to identify the same record.

Exactly one valid molecule creates a single-compound assessment. More than one valid molecule creates a library workflow. MolOptima does not currently generate novel molecules from this workspace.

## 6. Receptor and Docking

### 6.1 Receptor selection and preparation

Upload a receptor PDB or a prepared PDBQT as supported by the setup controls. For a PDB receptor, inspect chains, waters, hetero groups, alternate locations, and any bound-ligand context. Explicitly choose which chains and hetero groups are retained or excluded.

The conservative repair policy can reconstruct supported missing side-chain heavy atoms in existing standard residues. It does not automatically rebuild missing loops or whole residues, infer missing backbone segments, establish a biologically correct protonation state, add solvent or membrane, or experimentally validate the structure. Blocking missing-residue or backbone conditions stop preparation for review.

The original upload is never overwritten. Preparation records artifact identity, ligand-removal scope, repair decisions, added atoms, tool versions, hashes, and final PDBQT provenance.

### 6.2 Binding site and docking box

The binding site can begin from a selected bound reference ligand or explicit box coordinates. A ligand-derived box is a starting search region, not proof that the site or dimensions are biologically optimal. Manual centers may be negative or zero; all three box sizes must be positive.

The translucent viewer box represents the exact Vina search space. A box that is too small can exclude poses. A very large box increases search cost. Box-only edits do not require rebuilding an otherwise unchanged receptor.

### 6.3 Docking execution and interpretation

Docking configuration includes exhaustiveness, worker count, number of modes, energy range, and random seed where exposed. Confirm setup before running the combined calculation workflow.

MolOptima preserves returned Vina modes, reported affinities, RMSD lower/upper bounds, pose artifacts, receptor identity, and configuration provenance. More negative Vina scores are more favorable according to that scoring function under the specific receptor, site, and protocol.

A Vina score is computational docking or screening evidence. It is not experimental affinity, measured potency, measured free energy, or proof of a binding mode.

## 7. ADMET Prediction

ADMET refers to absorption, distribution, metabolism, excretion, and toxicity. MolOptima exposes a fixed 15-endpoint panel from three distinct model families. These endpoints must not be collapsed into an overall ADMET score.

### 7.1 ChemBERTa classification

ChemBERTa is the SMILES/transformer-based classification family used for nine fixed endpoints:

- Human intestinal absorption (HIA)
- P-gp inhibition
- CYP1A2 inhibition
- CYP2C19 inhibition
- CYP2C9 inhibition
- CYP2D6 inhibition
- CYP3A4 inhibition
- hERG liability
- AMES mutagenicity

The displayed probabilities and classes are model outputs, not assay measurements or experimental frequencies. MolOptima does not invent threshold markers for these endpoints when the production contract does not define one.

### 7.2 GMC-MPNN BBB

BBB permeability is produced by the separate GMC-MPNN BBB five-seed ensemble. The current production semantics are:

- output: raw five-seed ensemble probability;
- classification threshold: `0.5`;
- threshold status: `provisional_raw`; and
- calibration status: `not_frozen`.

Probability is not formal confidence. The current raw threshold must not be described as historically calibrated or as measured brain exposure.

### 7.3 Chemprop regression

Chemprop is the graph-based directed message-passing regression family used for five endpoints:

| Endpoint | Current unit |
|---|---|
| Caco-2 permeability | `log10(Papp [cm/s])` |
| Lipophilicity | `log-ratio` |
| Aqueous solubility | `log mol/L` |
| Plasma protein binding (PPB) | `percent bound` |
| Volume of distribution (Vd) | `L/kg` |

The raw value and exact unit are authoritative. MolOptima does not define one universal favorable range for these five endpoints and does not automatically label them good, bad, safe, or unsafe.

### 7.4 Availability and provenance

Model-family failures are isolated. If one family is unavailable or fails, completed results from other families remain visible with their own status and provenance. Missing, failed, not-run, and unavailable endpoints remain distinct and are never converted to zero.

## 8. ADMET Visualization

The **ADMET** workspace includes **Overview**, **Property Table**, **Visualize**, and **Compare**. Visual transformations support inspection; they do not change prediction values or create new scientific evidence.

### 8.1 Selected-compound profile

The profile summarizes one selected molecule across ten classification endpoints and five regression endpoints. It keeps raw numeric values, predicted classes where authoritative, units, status, and provenance available. Selecting a molecule in another ADMET surface updates the inspected profile by stable molecule ID.

### 8.2 Probability bars

Classification bars use a `0–1` probability scale. The numeric value and class remain visible. A threshold marker appears only where the current contract defines one; BBB uses `0.5`. A bar is not a confidence interval and its visual length does not establish experimental frequency.

### 8.3 Regression scales

Regression scale positions compare values for the same endpoint within the current molecule collection. They do not define a universal favorable range, therapeutic window, or good/bad classification. Always interpret the raw value with its unit.

### 8.4 Heat map

The heat map uses molecules as rows and the fixed 15 endpoints as columns.

- Classification columns use predicted probability on `0–1`.
- Each regression column uses its own endpoint-specific display scaling.
- Raw values and units remain available from the cell description.
- Missing values use an explicit `N/A` presentation and are not zero.
- The amber outline and selected-row text identify the inspected molecule without relying on color alone.

Color intensity between different regression endpoints is not a direct quantitative comparison because each endpoint has its own unit and display scale. The heat map uses local scrolling and windowed rendering while retaining all molecules; it does not silently sample the collection.

### 8.5 Distributions

Histograms show how available predicted values are distributed in the current molecule collection. Classification endpoints use the probability domain `0–1`; regression endpoints use raw values and endpoint units. The BBB plot can show the defined `0.5` threshold. Valid and unavailable counts are reported separately.

A distribution of predictions is not a model-validation plot. Missing values are excluded rather than placed into a zero bin.

### 8.6 Relationship plots

Relationship plots support regression-versus-regression, classification-probability-versus-regression, and classification-probability-versus-classification combinations. Each point represents one molecule with usable values for both selected endpoints. Axis labels retain endpoint names and units, and point inspection exposes molecule identity and raw values.

Only pairwise-valid observations appear. An apparent visual trend is descriptive and does not establish a causal relationship. MolOptima does not display an unsupported correlation statistic in this view.

### 8.7 Compound comparison

The comparison view accepts two to five explicitly selected compounds. It displays endpoint values, classes, units, statuses, provenance, and descriptive lowest/highest context for regression values. It does not calculate an overall score, choose a winner, or automatically rank the selected compounds.

### 8.8 Why there is no all-endpoint radar chart

The ADMET endpoints have different units, scales, and model meanings. MolOptima does not currently define a scientifically justified common normalization for an all-endpoint radar chart. Its omission prevents an arbitrary visual composite from being mistaken for a scientific score.

## 9. Chemical Space

Chemical Space provides descriptive structural exploration through **Map**, **Neighbors**, **Scaffolds**, and **Experimental Neighborhood** views where data are available.

### 9.1 Fingerprints and similarity

MolOptima uses Morgan fingerprints for explicit circular-feature comparison. Tanimoto similarity measures overlap for the implemented fingerprint representation. A high Tanimoto value supports a structural-similarity hypothesis; it does not establish equal activity, mechanism, safety, or biological equivalence.

### 9.2 PCA projection

Principal component analysis (PCA) projects major variation into fewer display dimensions. Position and distance in the projection are visualization coordinates, not measured molecular properties.

PCA projection distance is not Tanimoto similarity. Projection proximity is not itself molecular similarity, even when nearby points appear visually related.

### 9.3 Grouping and neighborhoods

Color/grouping can represent source or scaffold categories. Scaffold membership and fingerprint neighbors answer different structural questions. External Experimental Neighborhood records retain exact-versus-analog ownership and can be unavailable when the network or source service is unavailable.

## 10. Design Logic

Design Logic places independent evidence layers side by side. Depending on available calculation artifacts, these can include Morgan similarity, scaffold context, pharmacophore geometry, ProLIF interaction fingerprints, Vina pose context, matched molecular pairs, and experimental context.

MolOptima does not compute one overall Design Logic score, automatically select a winner, or automatically declare a scaffold hop.

### 10.1 Pharmacophore

The pharmacophore view is ligand-centered and receptor-frame-aware. It compares feature classes and their spatial geometry using qualified source atoms and available pose/reference context. Feature overlap supports a geometric hypothesis; it does not prove equal biological activity.

### 10.2 ProLIF interactions

ProLIF represents protein–ligand interaction fingerprints as ligand-relative interaction tokens. Jaccard comparison describes token-set overlap. Similarity supports an interaction-pattern hypothesis but does not prove equal affinity, mechanism, or potency.

### 10.3 Matched molecular pairs

A matched molecular pair identifies a defined structural transformation or relationship between two molecules. Without paired experimental evidence, an MMP does not establish potency improvement, activity direction, or causal structure–activity relationship.

### 10.4 Cross-layer interpretation

Preserved interactions with structural divergence may motivate a hypothesis, but they do not automatically establish a scaffold hop. Keep each evidence layer and its provenance separate.

## 11. Prioritization

Prioritization supports library decision-making with a backend-backed scientific setup and persisted result contract.

### 11.1 Current methods and setup

- **Standard Prioritization** uses the implemented standard method.
- **Multi-Parameter Prioritization** uses an applied **Prioritization Profile**.
- A profile can contain **Evidence Weights**, **Prioritization Rules**, and related **Target Context**.

The setup also records public-evidence choices and docking configuration where applicable. Applying setup changes configuration only. Execution remains part of the calculation workflow. Changing an applied setup after results exist produces **Results Need Recalculation** rather than silently rewriting historical science.

### 11.2 Results and interpretation

**Prioritization Score** and **Priority Rank** come from the persisted calculation contract. **Ranking Explanation** exposes the evidence and configured method behind a result. **Evidence Status** identifies whether required evidence is present or usable.

A high rank does not prove experimental activity, clinical success, or superiority across every property. The top-ranked molecule is not automatically the best compound. Ranking is decision support that must be interpreted with provenance, missing evidence, project context, and experimental plans.

## 12. Results

Results is the primary persisted scientific review workspace. It supports search, filters, sorting, paging, molecule inspection, review annotations, provenance, and broad exports. These view operations do not recalculate science.

Depending on what was run, a result can include molecular identity and properties, ADMET outputs, docking modes and artifacts, prioritization outputs, warnings, missing-data context, target/reference context, and model/runtime provenance.

Single-compound calculations remain assessments and do not fabricate a library rank. Library calculations preserve candidates that are invalid, hard-gated, failed, or otherwise unrankable with explicit reasons.

Review annotations such as selected, watchlist, deprioritized, or rejected are user review state, not model predictions.

## 13. Analysis

Analysis separates scientific setup from persisted result exploration. It does not automatically rerun calculations when filters or views change.

### 13.1 Pareto Analysis

Pareto Analysis identifies non-dominated trade-offs across selected objectives. A Pareto front contains candidates for which no other candidate improves every selected objective simultaneously. It does not create one combined Pareto score and does not choose a winner.

### 13.2 Sensitivity Analysis

Sensitivity Analysis perturbs an applicable Prioritization Profile under the displayed magnitude, sample count, and seed. It can report rank ranges, median rank, and top-N frequency for eligible candidates.

These results describe response to that defined perturbation procedure. They are not statistical confidence, formal uncertainty calibration, or experimental validation.

## 14. Experimental Data

Experimental Data keeps measurements attached to their source compounds and evidence layer. Three sources can be represented:

1. Imported CSV/TSV experimental measurements owned by the imported dataset.
2. Persisted calculation evidence owned by a saved MolOptima calculation.
3. External ChEMBL Experimental Neighborhood records for an exact structure or structural analog.

### 14.1 Imported measurements

Preview imported records before applying them. MolOptima preserves endpoint names, values, units, qualifiers/censoring, molecule identity, source fields, and validation flags where present. Search, endpoint filters, paging, and export change only the measurement view.

### 14.2 Exact and analog evidence

Exact evidence is attached to the exact matched structure. Analog evidence belongs to the measured analog. Analog activity must not be assigned automatically to the query compound, and structural similarity does not establish biological equivalence.

### 14.3 Patent, target, and reference context

Patent occurrence is context, not experimental validation or a legal conclusion. Patent absence does not establish novelty. A target or reference compound can provide project context, but its measured activity does not become query-compound activity.

No matching record is not proof of inactivity or novelty. External lookup failure does not modify local MolOptima data.

## 15. Settings and Scientific Runtime

Settings owns application-wide runtime availability and diagnostics. Scientific configuration and results remain in their scientific workspaces.

### 15.1 Runtime status

- **Available** — the qualification probe succeeded.
- **Unavailable** — the component could not be used by the current runtime.
- **Probe Timed Out** — availability was not determined before the probe limit.
- **Probe Error** — the probe ended with a reported error.
- **Refreshing** — an earlier result remains visible while a new check runs.

Available does not mean the model has run for the active molecule, that a current result exists, or that a prediction is guaranteed correct. Refreshing runtime status checks capability; it does not run scientific inference.

The runtime panel reports ChemBERTa, GMC-MPNN BBB, Chemprop, receptor preparation, Vina, Open Babel, and other packaged components according to the installed release.

## 16. Help System

Select **Help** in the system navigation to open searchable Central Help. Each supported scientific workspace also has a module Help action, and selected controls have contextual Help icons.

Select **Open User Manual** in Central Help to open this packaged offline document. In Module Help, the same action opens the corresponding manual section when a stable section mapping exists. Opening Help or the manual does not require an active calculation and does not select molecules, change configuration, run models, or alter history.

The manual window includes **Print manual**. All content, styles, and section links are packaged locally; internet access is not required.

## 17. Interpretation Guidelines

- Predictions are computational estimates, not measurements.
- Probability is not formal confidence.
- Applicability depends on the molecule and the validated model domain.
- Vina score is not experimental binding affinity or measured free energy.
- Fingerprint, pharmacophore, and interaction similarity do not establish biological equivalence.
- Analog evidence belongs to the measured analog.
- Patent absence does not establish novelty.
- Missing experimental records do not prove inactivity.
- Prioritization is decision support, not an automatic best-compound conclusion.
- Visualization reorganizes existing results; it does not create new scientific evidence.
- Computational conclusions should be tested experimentally when appropriate.

## 18. Troubleshooting

### 18.1 Backend unavailable

Close MolOptima, confirm another instance is not already running, restart once, and allow local services to initialize. If the problem persists, record the application status and affected runtime card.

### 18.2 Runtime probe problem

Open **Settings > Scientific Runtime** and use **Refresh runtime status** once. Distinguish **Unavailable**, **Probe Timed Out**, and **Probe Error**; they do not mean the same thing. Do not repeatedly retry a timed-out probe without investigating the reported component.

### 18.3 Molecule rejected

Review the exact validation reason. For tables, confirm the structure column. For SDF, confirm one record per file. For ligand PDB, prefer SDF when connectivity, bond order, or charge is ambiguous.

### 18.4 Docking unavailable or failed

Confirm that the ligand is valid, the receptor artifact is ready, all box sizes are positive, the box covers the intended region, and Vina/receptor-preparation runtimes are available. Inspect the owning error rather than substituting a score.

### 18.5 Results Need Recalculation

The applied scientific setup changed after the displayed results were generated. The existing result remains historical. Rerun the relevant calculation when the new setup should take effect.

### 18.6 Manual unavailable

The User Manual is packaged with the desktop application. If the action reports that the offline resource is unavailable, reinstall or repair the matching application release rather than browsing to a development source path.

## 19. Scientific Terminology Glossary

| Term | Meaning in MolOptima |
|---|---|
| ADMET | Absorption, distribution, metabolism, excretion, and toxicity; a family of distinct endpoints, not one score. |
| AMES | Classification endpoint related to bacterial mutagenicity assay outcome. |
| BBB | Blood-brain barrier; reported as a raw five-seed GMC-MPNN classification output. |
| Caco-2 | Chemprop permeability endpoint reported as `log10(Papp [cm/s])`. |
| ChemBERTa | Model family used for nine fixed ADMET classification endpoints. |
| Chemprop | Model family used for five fixed ADMET regression endpoints. |
| CYP | Cytochrome P450 enzyme-family metabolism classification endpoints. |
| GMC-MPNN | Five-seed graph-model ensemble used for BBB classification. |
| HIA | Human intestinal absorption classification endpoint. |
| hERG | Classification endpoint related to hERG channel liability. |
| MMP | Matched molecular pair related by a defined structural transformation. |
| Morgan fingerprint | Circular-feature representation used for explicit structure comparison. |
| P-gp | P-glycoprotein inhibition classification endpoint. |
| PCA | Principal component analysis; a lower-dimensional projection, not a similarity metric. |
| Pharmacophore | Chemical feature classes and their spatial arrangement used for geometric comparison. |
| PPB | Plasma protein binding, reported as percent bound. |
| ProLIF | Protein–ligand interaction fingerprints used for interaction-pattern comparison. |
| Tanimoto similarity | Fingerprint feature-set overlap; meaning depends on the fingerprint definition. |
| Vd | Volume of distribution, reported in `L/kg`. |
| Vina | AutoDock Vina, used for protocol-dependent computational docking and screening scores. |

## 20. Reproducibility and Provenance

Reproducibility depends on more than a displayed value. Preserve the molecule and receptor identities, source records, canonical representations, receptor-preparation decisions, docking box and seed, model/runtime identities, profile identity and hash, endpoint status, warnings, and calculation/job identity.

Results packages can include a `results_manifest.json` inventory and `SHA256SUMS` hashes. Hashes help detect changed files; they do not validate scientific correctness. A saved calculation should be distinguished from the currently active calculation, and a changed setup should not be retroactively attributed to an older result.

Do not share unpublished structures, confidential project data, credentials, patient data, or private machine paths through screenshots or exported support artifacts.

## 21. File Formats and Exports

### 21.1 Inputs

Supported molecule inputs include SMILES text, CSV/TSV structure tables, single-record SDF files, and conservatively interpreted ligand PDB files. Receptor inputs include PDB and qualified prepared PDBQT routes. Experimental measurements use the CSV/TSV contracts shown in the Experimental Data workspace.

### 21.2 Exports

The Results workspace can create a deterministic ZIP results package from persisted outputs. Contents depend on analysis mode and calculations performed and can include compound/library tables, ADMET data, selected Prioritization Profile, prioritized structures, receptor preparation records, docking results and poses, analysis results, runtime provenance, manifests, and hashes.

Contextual CSV, Markdown, SDF, SVG, or other exports appear only where the owning workspace implements them. Missing calculation families do not produce fabricated files. ADMET visualization views do not currently add separate plot-export actions.

## 22. Limitations

- MolOptima does not replace experimental testing or expert review.
- It does not currently implement generative molecule design.
- It does not calculate one overall ADMET score or risk score.
- BBB probability is raw, uses the provisional `0.5` threshold, and has `not_frozen` calibration status.
- Vina scores are protocol-dependent computational outputs, not measured affinity.
- Similarity and projection views do not establish biological equivalence.
- MMP relationships do not establish causal SAR without experimental support.
- Public identity, bioactivity, and patent sources can be incomplete or unavailable.
- Absence of a public or experimental record is not negative evidence.
- Receptor preparation does not establish the biologically correct protonation state or reconstruct every missing structural region.
- Ranking and analysis depend on the selected method, evidence, and current calculation.
- No all-endpoint ADMET radar chart is shown because no justified common normalization is defined.
- Interactive tutorial mode is not currently implemented.

## 23. Reporting a Problem

Record the MolOptima version, Windows version, backend status, affected workspace, input format, affected runtime card and state, exact error text, whether one restart reproduces the issue, and a safe provenance/results package where appropriate.

Do not include private structures, unpublished research data, credentials, patient data, or confidential local paths unless an approved support channel explicitly permits them.

Close MolOptima normally with the window close control. The application stops its managed local backend during ordinary shutdown.
