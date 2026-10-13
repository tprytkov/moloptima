# Design Logic workspace

Design Logic is a pose-specific comparison workspace for patterns observed in MolOptima computational outputs. It asks how molecules with different structures retain or alter predicted protein-contact patterns; it does not expose a neural network's internal reasoning and does not provide experimental binding evidence.

## Independent measurements

- **Structural similarity** is the existing Morgan fingerprint Tanimoto to an explicitly selected reference molecule. It is not derived from the chemical-space projection, scaffold identity, docking score, or interaction fingerprint.
- **Interaction fingerprint similarity** is Jaccard similarity over unique canonical ProLIF interaction tokens for two explicitly selected Vina modes. A token records chain, residue, interaction type, and ligand-relative direction where applicable.
- **Scaffold relationship** uses the existing Bemis–Murcko groups and is shown only as descriptive context.
- **Vina affinity** remains the docking engine's independent pose score.

No combined score, automatic scaffold-hop classification, or inferred preference is produced.

## Workspace behavior

The left rail fixes a reference molecule, its reference Vina mode, and the comparison Vina mode. Selecting a scatter point changes only the inspected comparison; changing the reference requires the explicit **Set as reference** action. A molecule missing the selected mode remains unavailable—MolOptima does not substitute the best-scoring or most interaction-similar pose.

The scatter uses Morgan Tanimoto on the X-axis and interaction fingerprint similarity on the Y-axis. Its upper-left region is described neutrally as lower structural similarity and higher interaction similarity. Points with missing, failed, or incompatible fingerprints remain visible as explicit states rather than being assigned a zero.

The binary residue-by-molecule matrix contains one row per canonical residue-interaction token and one column per bounded molecule/pose. Rows use deterministic chain/residue/type ordering; columns retain the workspace's structural-similarity ordering. It is not clustered. Filters operate only on interaction type, chain, residue text, and the selected molecule.

The inspector separates the deduplicated binary token from its underlying raw atom-level contacts. Raw contacts can include protein and ligand atoms, distance, angle or other geometry, interaction direction, selected pose, and engine provenance. Repeated atom contacts do not become multiple fingerprint features. The reference comparison is partitioned neutrally into shared, reference-only, and comparison-only tokens.

## Synchronized interaction visualization

The selected molecule and explicit Vina mode drive both visualization tabs. The 3D view reuses MolOptima's 3Dmol receptor/docking viewer and the validated receptor and pose artifacts. Connectors are built only from qualified ProLIF protein and ligand atom serials; unresolved authoritative identities are omitted instead of replaced by nearest-atom guesses. The **Interactions** display emphasizes recorded contacts. **Pocket** adds the complete-residue receptor context within the already-qualified 8 Å display policy without creating new contacts or scores.

The native 2D map combines a deterministic RDKit SVG ligand depiction with the cached raw interaction records. Contacted template atom indices anchor the connectors. Residues are placed outward from those anchors using deterministic angular candidates and collision checks. Placement is schematic rather than a literal projection or physical-distance scale. Hydrophobic, hydrogen-bond, aromatic, ionic, cation–π, and van der Waals classes combine line pattern, thickness, marker, and restrained color. The optional pocket-context contour is deferred because the current qualified data do not define a scientifically warranted 2D contour.

Matrix rows, raw-contact controls, 2D connectors, and 3D connectors share the same canonical-token selection. Selecting a different molecule or pose clears stale selection state; neither action changes the reference.

## Presentation-only export

The 2D map exports editable vector SVG or a PNG at an explicit width with height calculated from the diagram aspect ratio. The 3D viewer temporarily renders its scene at the selected target dimensions, preserves the camera, and restores its live dimensions afterward. Width presets are 1920, 2560, 3840 (default), and 5120 pixels, with a bounded custom option. Title/identity, interaction legend, background, and—on the 2D map—recorded distances are optional. Export serializes the current display only and never launches ProLIF, Vina, Open Babel, receptor preparation, Morgan similarity, or interaction-similarity calculation.

## Cache and execution policy

Normal workspace retrieval is cache-only and never launches ProLIF. A missing fingerprint is labeled **Not analyzed**. The explicit **Analyze selected pose** action may invoke the isolated ProLIF runtime for exactly one selected molecule and mode; typed runtime and input failures are returned without changing docking results. Collection display, hover, selection, matrix rendering, and filtering never trigger analysis. Rendering is bounded to 50 comparison molecules, 12 matrix columns, and 20 raw-contact rows at a time.

## Scientific limitations

Interaction fingerprints describe predicted contacts in selected docking poses. They are not experimental binding evidence, and protonation is not scientifically resolved. Results are pose-specific: no multi-pose consensus, union, occupancy, averaging, affinity weighting, or automatic best-mode selection is performed. Structural divergence plus interaction similarity is evidence for scientist review, not confirmation of a scaffold hop, binding mode, causal design rule, or beneficial interaction change.
