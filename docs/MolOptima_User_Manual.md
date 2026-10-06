# MolOptima User Manual

## Desktop Application for ADMET Prediction, Molecular Docking, and Multiparameter Molecular Prioritization

This manual describes the MolOptima Windows desktop application. It is intended for scientists, students, researchers, and instructors. MolOptima is computational research software, not clinical or experimental decision-making software.

## 1. Introduction

MolOptima is a local desktop application for evaluating one small molecule or prioritizing a library of small molecules. It brings the following activities into one traceable workflow:

- molecular input, chemical validation, and canonicalization;
- molecular and structural property calculation;
- rigid receptor preparation;
- AutoDock Vina molecular docking;
- ADMET prediction with applicability and uncertainty context;
- multiparameter prioritization;
- chemical-space, Pareto, and weight-sensitivity analysis;
- biopharma intelligence from local and optional public sources; and
- reproducible result exports with provenance records and hashes.

Predictions and docking scores are computational estimates. They are not experimental measurements and do not establish biological activity, safety, efficacy, or clinical suitability.

## 2. System Requirements

The Windows desktop release contains bundled scientific runtimes. Ordinary users do not need to install Python, Conda, RDKit, or CUDA separately.

Final minimum system requirements will be established during release qualification. No minimum Windows version, RAM, CPU, disk-space, or graphics requirement is currently established in the repository.

## 3. Installing MolOptima

The current `nsis-web` release consists of two matching files:

- the **MolOptima Web Setup** executable; and
- the external **x64 NSIS package** used by that setup executable.

Keep both files in the same folder throughout installation. The external package is part of the release even though it is not opened directly.

1. Download or copy both matching release files.
2. Confirm that they remain together in the same folder.
3. Double-click the MolOptima Web Setup executable.
4. Choose an installation location if the installer offers that choice.
5. Complete the installation.
6. Launch MolOptima from its Desktop or Start Menu shortcut.

The per-user installation resolves under:

```text
%LOCALAPPDATA%\Programs\MolOptima\MolOptima.exe
```

Users should launch the installed application through its shortcut. The source repository is not required for ordinary use.

## 4. Starting MolOptima

Open MolOptima from the Desktop or Start Menu. The application automatically starts its local scientific backend; no command prompt is normally required. Wait for the header status to show **Online** before beginning a calculation.

- **Online** means the local backend is available to the desktop interface.
- **Offline** means the local backend is not currently reachable.

Startup can take several seconds while local components initialize.

## 5. First Start and Scientific Runtime Check

Open **Settings**, then find **Scientific Runtime**. The current cards and their displayed runtime components are:

- **ChemBERTa classification**
- **GMC-MPNN BBB**
- **Chemprop regression**
- **Receptor Preparation**, showing Meeko and Gemmi
- **Docking**, showing Vina and Open Babel

The cards can show these states:

- **Checking** — the runtime compatibility check is still running.
- **Available** — the runtime passed its availability and compatibility check.
- **Refreshing** — an existing result remains visible while a new check runs.
- **Error** — the check ended with a reported problem.

The larger machine-learning runtimes can take longer to check on a cold start than lightweight native tools. Checks run asynchronously, so the interface should remain usable while they complete. Opening this page checks runtime availability; it does not run molecule predictions.

When **Refresh runtime status** is selected, previous results remain visible while affected cards show **Refreshing**. MolOptima polls for updated status until every check reaches a terminal state, then polling stops. Wait for the refresh to finish before requesting another one.

## 6. Application Navigation

The primary navigation is:

**NEW CALCULATION**

- New Calculation

**WORKFLOW**

- Molecules
- Receptor & Docking
- ADMET
- Prioritization
- Results

**ANALYSIS**

- Analysis

**SYSTEM**

- Settings

## 7. Starting a New Calculation

Select **New Calculation**, then **Start New Calculation**, to clear the current transient workflow state and go to **Molecules**. This resets the current molecule collection, current job state, target and docking configuration, prioritization selection, and optional public-lookup selections.

This action does not silently delete historical job files, previous exported files, cached resources, or installed scientific runtimes.

## 8. Molecule Input

MolOptima accepts:

- one SMILES string;
- multiple SMILES strings, one per line;
- `molecule_id` followed by SMILES, one molecule per line;
- CSV and TSV tables;
- one molecule in an SDF file;
- multiple individual SDF files;
- one ligand PDB file; and
- multiple individual ligand PDB files.

CSV and TSV files use a `smiles` or `canonical_smiles` structure column. If a table contains more than one plausible structure column, enter the intended column name in **Explicit CSV/TSV structure column**. MolOptima does not guess between ambiguous columns.

Multi-record SDF files are currently not supported. For an SDF library, select multiple files or select a folder containing one molecule per SDF file. Folder selection reads the folder's top-level files.

For ligand PDB input, chemistry reconstruction is conservative. Multi-atom structures require usable explicit `CONECT` information, and ambiguous bond orders or formal charges are rejected rather than guessed. SDF is preferred for small molecules because it preserves bond orders and formal charges more reliably. Original structure coordinates are retained as provenance; docking coordinates are generated from the validated canonical SMILES.

Select **Validate and load molecules**. MolOptima reports submitted, valid, invalid, unresolved PDB, duplicate, and ignored-file counts, plus a preview with warnings or failure reasons. Valid structures are canonicalized. Invalid records remain visible for traceability but are skipped by scientific prediction.

- Exactly one chemically valid molecule selects **Single Compound Analysis**.
- More than one chemically valid molecule selects **Library Prioritization**.

Single-compound analysis reports compound-level properties, predictions, optional docking, and profile interpretation. It does not create a library rank, Pareto front, or rank-sensitivity result.

## 9. Receptor & Docking

### Preparing a Receptor for Docking

1. Select and upload a receptor PDB. Inspect the detected protein chains, waters, hetero groups, and alternate locations.
2. Explicitly choose **Use a bound reference ligand** or **Enter docking box coordinates manually**.
3. Select at least one protein chain, choose **Keep** or **Exclude** for every hetero group, and resolve each alternate-location choice. Waters are removed and recorded.
4. Inspect the receptor and translucent search box together, then select **Prepare Receptor**.
5. MolOptima removes any explicitly selected reference-ligand copies, repairs the protein, validates that repair, reassembles retained hetero groups, runs Meeko, validates the result, and saves the PDBQT.
6. Confirm that **Prepared receptor PDBQT** is ready. The saved receptor is reused for docking; it is not regenerated for every ligand.

In **Use a bound reference ligand** mode, select the ligand by residue name, chain, residue number, and atom count. If symmetry-related copies exist, explicitly select the complete removal set. MolOptima calculates the starting box from the selected copy's heavy-atom limits:

`center X = (x min + x max) / 2`

`box size X = (x max - x min) + 2 × padding`

The same calculation applies to Y and Z. The default padding is 4 Å, meaning 4 Å on each side and 8 Å total added to an axis span. Changing padding recalculates from the original ligand coordinates. All six center and size values remain editable, and **Reset ligand box (4 Å)** restores the ligand-derived starting values. The selected ligand defines a starting search region; it does not prove that the pocket or dimensions are biologically optimal.

For the qualified 9IIR example, the reference is chain A, YLI 601, with all five YLI 601 copies in chains A–E selected for removal. At 4.0 Å padding the initial center is X 135.2005, Y 144.1640, Z 140.0455, and the initial size is X 13.593 Å, Y 12.854 Å, Z 21.093 Å. These values are specific to that structure and remain editable.

In **Enter docking box coordinates manually** mode, enter center X/Y/Z and positive size X/Y/Z values. Centers may be zero or negative. The center controls search-region location, while size controls its extent. A box that is too small can exclude relevant poses; an unnecessarily large box increases search space and computational cost. No ligand is automatically removed in manual mode. The box is stored separately from the receptor, so box-only edits do not rerun receptor preparation.

MolOptima checks the protein for missing heavy atoms. Under the versioned conservative policy, PDBFixer reconstructs supported missing side-chain heavy atoms in existing standard residues from computational templates. MolOptima does not automatically rebuild missing loops or whole residues, add terminal atoms, replace nonstandard residues, add solvent or membrane, add repair-stage hydrogens, or minimize the receptor. Missing residue blocks or missing backbone atoms stop preparation for review. Added atoms are computational reconstructions, not experimentally observed coordinates.

The immutable artifact sequence is: original receptor → ligand-removed receptor when applicable → protein before repair → repaired protein/reassembled receptor → Meeko input → saved PDBQT. The original upload is never overwritten. Provenance records ligand coordinates and removal scope, repair additions, observed-atom displacement, clashes, hetero-group decisions, tool versions, hashes, and the final PDBQT identity.

The downstream Meeko/RDKit stage completes the AutoDock/Vina representation. It does not optimize hydrogens with Reduce2 or establish biologically correct pH-dependent protonation. A prepared receptor and its docking box are reproducible computational inputs, not experimental validation.

The receptor viewer displays the loaded structure and translucent Vina search box. Enter positive X, Y, and Z dimensions in ångströms. Blank or invalid fields cannot produce a valid configuration.

Advanced Vina settings include exhaustiveness, worker count, number of modes, energy range, and random seed. After the receptor, center, and positive dimensions are ready, select **Confirm Docking Setup** and run docking from the workflow page.

The production desktop runtime uses AutoDock Vina 1.1.2. Docking output can include Vina affinities, returned docking modes, RMSD lower/upper bounds, and pose PDBQT artifacts where generated. The reported best affinity is the minimum finite returned Vina mode. More negative scores generally indicate more favorable scores according to the Vina scoring function. A Vina score is protocol-, receptor-, and site-dependent and is not an experimental binding free energy.

## 10. ADMET

The ADMET view organizes outputs from three current model families.

### ChemBERTa classification

ChemBERTa supplies exactly nine public classification endpoints:

- Human Intestinal Absorption (HIA)
- P-glycoprotein (P-gp)
- CYP1A2
- CYP2C19
- CYP2C9
- CYP2D6
- CYP3A4
- hERG
- Ames mutagenicity

These are classifier outputs, not measured percentages or experimental assay results.

### Chemprop regression

Chemprop supplies exactly five regression endpoints:

- Caco-2 permeability
- lipophilicity
- aqueous solubility
- plasma protein binding (PPBR)
- volume of distribution (Vdss)

These are model estimates in the endpoint units and conventions shown by the application, not experimental measurements.

### GMC-MPNN BBB

The blood-brain barrier output comes from a five-model GMC-MPNN ensemble; it is separate from the nine public ChemBERTa classifiers. MolOptima reports the arithmetic ensemble mean and population standard deviation across the five models. The raw `0.5` classification threshold is provisional, and calibration is not frozen. Interpret the mean as a raw ensemble model output, not as a calibrated value or measured brain exposure.

Model-family failures are isolated: when one family is unavailable, MolOptima preserves available results from other families and displays status and warning context.

## 11. Prioritization

For a molecular library, MolOptima can combine multiple computational objectives into an auditable decision-support score. **Legacy v1 compatibility scoring remains the application default.** Prioritization v2 is an available, opt-in configurable method with these current profile choices:

- **CNS Drug Discovery**
- **General Systemic Oral**
- **Peripheral Systemic Oral**

The current `1.0.0` built-in profiles are frozen, read-only release configurations. Historical drafts may appear for reproducibility but are not the primary choices. Select **Custom** or import profile JSON to create an editable profile, then validate it before scoring.

Depending on the selected profile, prioritization can include:

- a docking contribution normalized within successfully docked molecules in the current campaign;
- ADMET contributions grouped by domain;
- a molecular-quality contribution, including QED in the current built-in configurations;
- safety or liability penalties and warnings;
- missing-data and uncertainty policies; and
- required endpoints or other hard gates, alongside soft desirability and liability effects.

The detail view exposes raw values, transforms, contributions, liabilities, missing evidence, uncertainty context, profile identity/version/hash, and warnings. Synthetic accessibility (SA) and PAINS/Brenk structural alerts are display or warning context in the current built-in v2 profiles; they have zero ranking weight and are not scored objectives. Other configured endpoint liabilities can still contribute soft penalties or hard criteria according to the selected profile.

A computational ranking does not replace medicinal-chemistry review, experimental testing, or project-specific scientific judgment.

## 12. Results

The **Results** view presents the current calculation and supports filtering, compound inspection, review annotations, and downloads. Depending on the workflow and available evidence, results include:

- molecular identifiers, source information, canonical SMILES, and calculated properties;
- ChemBERTa, GMC-MPNN, and Chemprop results and their status/context;
- docking status, best Vina mode, mode and RMSD information, and pose references;
- prioritization component and final scores;
- rank and eligibility for library calculations;
- warnings, missing-data context, structural alerts, and applicability/uncertainty information; and
- selected profile identity, version, status, and hash.

For a single valid molecule, the view is a compound assessment: molecular properties, ADMET, optional docking, and profile interpretation are available, but library-relative score components, percentile, ranking, Pareto, and rank sensitivity are omitted. For a library, eligible molecules can receive prioritization scores and ranks; invalid, hard-gated, or otherwise unrankable molecules remain visible with reasons.

Review controls allow a compound to be marked unreviewed, selected, watchlist, deprioritized, or rejected, with a local note. These review decisions are user annotations rather than model outputs.

## 13. Analysis

The **Analysis** page contains three tabs:

- **Chemical Space**
- **Pareto & Sensitivity**
- **Biopharma Intelligence**

### Chemical Space

The structural diversity map uses RDKit Morgan-fingerprint-derived coordinates reduced by principal component analysis (PCA). It displays valid molecules, diversity clusters, selected/watchlist state, and target references when available. Coordinates are comparative visualization features, not measured chemical properties.

### Pareto & Sensitivity

Pareto analysis identifies non-dominated trade-offs among the currently selected objective dimensions. A molecule on an earlier Pareto front is not automatically the best experimental choice; it represents a particular computational trade-off.

Top-level weight sensitivity repeatedly perturbs configured profile weights using the displayed magnitude, sample count, and seed. It reports rank ranges, median rank, and top-N frequencies for eligible library molecules. It describes robustness to that defined perturbation procedure, not experimental confidence.

### Biopharma Intelligence

This tab brings together local identity and similarity information, evidence summaries, structural alerts, and any explicitly enabled PubChem, ChEMBL, SureChEMBL, or target-reference context. Public lookups are optional and may require network access. Patent-context signals are not legal conclusions.

All three tabs are decision-support tools, not experimental validation.

## 14. Exporting Results

The Results view can create a deterministic results package from persisted outputs. Each package includes a `results_manifest.json` artifact inventory and `SHA256SUMS` hashes, plus a run summary and package README. The complete package can be downloaded as a ZIP.

Contents depend on analysis mode and which steps were run. When applicable, a package can contain:

- compound or library result tables;
- ADMET and molecular-property tables;
- the selected prioritization profile and its identity/hash;
- a rank-sorted prioritized-compounds table and SDF;
- receptor preparation information and verified receptor artifacts;
- docking result tables, pose PDBQT files, and docking provenance;
- Pareto and sensitivity tables and SVG visualizations;
- scientific-runtime identities and provenance in the run summary; and
- manifests and cryptographic hashes.

Single-compound packages use compound-level files and omit library-only artifacts. Docking files are present only when docking ran. Pareto and sensitivity files are present only when those analyses were run and persisted. Hashes help detect changed files, while manifests document the exported inventory for reproducibility and provenance.

The interface also provides contextual CSV, Markdown, and SDF exports for filtered or reviewed candidates where those actions are available.

## 15. Closing MolOptima

Close the desktop application normally using the window close control. During normal shutdown MolOptima stops its local backend. No terminal commands are required during ordinary use.

## 16. Troubleshooting

### A. Application shows Offline

1. Close MolOptima.
2. Confirm another MolOptima instance is not open.
3. Restart MolOptima.
4. Wait for **Online**.

### B. Port 8000 already in use

MolOptima currently uses the local address `127.0.0.1:8000`. An unrelated local application already using that port can prevent the backend from starting.

Advanced users may inspect the listener in PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
```

Close the application known to own the port, then restart MolOptima. Do not terminate an unidentified process.

### C. Scientific Runtime remains Checking

Large machine-learning compatibility checks can take longer on a cold start. Allow the card to reach a terminal **Available** or **Error** state while continuing to use other responsive parts of the interface.

### D. `runtime_probe_timeout`

1. Close and reopen MolOptima.
2. Open **Settings > Scientific Runtime**.
3. Select **Refresh runtime status** once.
4. If the problem persists, record the exact card name and complete error text.

Do not change the runtime timeout.

### E. Docking failure

Check:

- that each ligand passed chemical validation;
- that receptor preparation completed or a prepared PDBQT passed validation;
- that the receptor PDBQT readiness card is ready;
- that all three search-box dimensions are positive;
- that the search-box center and extent cover the intended site; and
- that Vina and Open Babel show **Available** in Scientific Runtime.

### F. Installed runtime problem

The installed release is designed to use its bundled runtimes. Ordinary users should not install separate development runtimes to repair an installed application. Record the affected runtime card and error, restart once, and report a persistent failure.

## 17. Scientific Interpretation and Limitations

- ADMET outputs are model predictions.
- Docking scores are computational scoring-function outputs.
- Vina score is not experimental binding free energy.
- Model applicability depends on the molecule's similarity and relevance to each model's training domain.
- Ensemble dispersion is uncertainty/context, not experimental confidence.
- Receptor preparation does not establish the biologically correct protonation state; it repairs only supported missing side-chain heavy atoms and does not rebuild missing loops or whole residues.
- Public identity, bioactivity, and patent-context data can be incomplete or unavailable.
- Predictions should be confirmed experimentally where appropriate.
- MolOptima prioritization is decision support, not a final experimental determination.

## 18. Information to Provide When Reporting a Problem

Record the following without including private structures or confidential project data unless an approved support channel permits them:

- MolOptima version;
- Windows version;
- **Online** or **Offline** status;
- affected workflow page;
- molecule input format;
- affected Scientific Runtime card and state;
- exact error text;
- whether the problem still occurs after one restart; and
- an exported provenance/results package where appropriate and safe to share.
