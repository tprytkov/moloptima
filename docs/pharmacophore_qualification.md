# Pose-specific pharmacophore scientific qualification

## Scope and conclusion

This qualification defines a ligand-centered, pose-specific pharmacophore representation in the receptor coordinate frame. It answers only which RDKit molecular-recognition features exist on a ligand and where their participating atoms occur in an explicit Vina pose. It is independent of Morgan/Tanimoto similarity, Murcko scaffolds, ProLIF interactions, and Vina affinity. It is not evidence of equivalent activity, affinity, potency, or binding mode.

The extraction and comparison method passed the Batch 3B acceptance criteria on 13 October 2026. It is qualified for backend production use with explicit thresholds and transparent metrics. No universal distance threshold or aromatic-orientation rule is frozen, and no frontend integration is included in this batch.

## Frozen feature definition and vocabulary

- Python: 3.11.15
- RDKit: 2026.03.3
- feature definition: `RDConfig.RDDataDir/BaseFeatures.fdef`
- exact feature-definition SHA-256: `87ab54bd717af50a78a710d23e7737a2cafc96e5293bf6257ecdda86b6da3f65`
- pharmacophore schema: `moloptima-pose-pharmacophore-v1`
- geometry policy: `selected-pose-atom-centroid-v1`

| RDKit family | MolOptima class |
| --- | --- |
| Acceptor | HBA |
| Donor | HBD |
| Aromatic | AROMATIC |
| Hydrophobe | HYDROPHOBIC |
| LumpedHydrophobe | HYDROPHOBIC |
| PosIonizable | POSITIVE_IONIZABLE |
| NegIonizable | NEGATIVE_IONIZABLE |

The installed factory also emits `ZnBinder`; Batch 3B deliberately ignores it because it is outside the qualified vocabulary. The exact canonical mapping is itself hashed and comparison compatibility requires the same mapping hash.

## Pose-resolved chemistry and provenance

Chemical graph, bond orders, formal charges, aromaticity, stereochemistry, and canonical isomeric identity come only from the immutable RDKit SDF template written by the production docking pipeline. The molecule is not reconstructed from PDBQT.

Selected-pose coordinates are propagated through `moloptima-template-pose-atom-mapping-v2`: preparation-time SDF-to-input-PDBQT coordinate identity followed by verification that Vina preserved input atom count, order, serial, name, AutoDock type, and element. Every feature retains authoritative template, input-PDBQT, and pose atom indices. The mapping explicitly records `positional_identity_assumed=false`; no nearest-atom matching, graph guessing from PDBQT, or ligand realignment is used.

Nonpolar hydrogens omitted by AutoDock are removed from the feature-extraction molecule after original template indices are attached to heavy atoms. This preserves template chemistry and implicit valence while using mapped heavy-atom pose coordinates. Polar-hydrogen provenance remains in the v2 mapping, but Batch 3B does not qualify donor vectors from it.

## Feature records and geometry

A deterministic feature ID hashes canonical class, original RDKit family/type, and sorted authoritative template atom indices. Feature records also contain the selected mode, template and pose hashes, mapped pose/input atom indices, center, geometry type, formal charge, feature-definition hash, mapping schema, RDKit version, and unresolved-protonation status.

- Atom-centered feature: the mapped selected-pose atom coordinate.
- Multi-atom feature: the unweighted centroid of participating mapped selected-pose atoms.
- Aromatic feature: the same centroid plus a least-squares plane normal when at least three non-collinear atoms are available. Normal sign is canonicalized for serialization and ignored during comparison through `abs(dot(n1,n2))`.
- HBA/HBD direction: `unavailable`. No lone-pair vector is invented, and an HBD vector is not claimed without separately qualified explicit-hydrogen geometry.
- Ionizable features: RDKit feature-definition classes, not claims about solution-state charge. Actual participating-atom formal charge is retained separately.
- Protonation: `not_scientifically_resolved` for every feature set.

The installed `BaseFeatures.fdef` includes neutral tertiary nitrogen in `NDonor` as well as `PosIonizable`. Accordingly, the qualification output preserves that frozen RDKit behavior but does not claim that such a site is protonated or donating in the observed pose. The same file marks neutral carboxylic acid as `NegIonizable` and emits acceptor features on both oxygen atoms; these are feature-definition semantics, not biological-state assertions.

Hydrophobe and LumpedHydrophobe both map to HYDROPHOBIC, while their original subtype remains visible. Deduplication requires the same canonical class, RDKit family/type, and exact template atom set. Merely overlapping features are not merged. No exact duplicate emission occurred in the real dataset; a deterministic duplicate fixture verifies the policy.

## States and compatibility

Valid extraction states are `available` and `no_supported_features`. Typed failures include `template_missing`, `pose_missing`, `mapping_incompatible`, `chemical_graph_invalid`, `feature_definition_unavailable`, `feature_extraction_failed`, and `geometry_unavailable`. A failure is never converted into an empty feature set. Protonation is an explicit limitation rather than a fabricated state.

Comparison requires the same receptor identity and prepared-receptor SHA-256, valid selected poses, pharmacophore schema, feature-definition SHA-256, canonical mapping SHA-256, and v2 atom-mapping schema. Differing receptor frames return `incompatible` unless a future authoritative receptor alignment is separately qualified. Ligands are never aligned to each other.

## Matching and metrics

Candidate pairs must have the same canonical class and a center distance less than or equal to the explicit threshold. A SciPy linear-sum assignment with deterministic feature-ID ordering produces globally sensible one-to-one matches; dummy assignments ensure maximum feasible match count before distance minimization. Aromatic orientation can additionally require a sign-invariant plane angle within an explicit tolerance.

Metrics are reported directly:

- reference coverage = matched count / reference count;
- comparison coverage = matched count / comparison count;
- pharmacophore feature overlap = `2 * matched / (reference count + comparison count)`;
- matched-center RMSD = root-mean-square distance between matched centers in the common receptor frame, without realignment;
- for one match, RMSD is null and the single distance is reported separately;
- for zero matches, distance summaries are null;
- if both valid sets are empty, status is `both_empty` and overlap/coverage are null;
- if one set is empty, status is `one_empty`, matched count is zero, empty-side coverage is null, and nonempty-side coverage is zero.

Every match preserves both feature IDs, class, template/pose atom indices, both coordinates, distance, orientation angle when evaluated, and the active criteria.

## Real qualification dataset

Historical persisted jobs lacked authoritative template artifacts and were not reconstructed. A new temporary run instead used the current production RDKit → Open Babel → Vina pipeline with one current prepared receptor, its approved reference-ligand box, seed 2025, exhaustiveness 8, and exactly three requested modes. Exact receptor and source-ligand identities were retained only in the private, off-repository qualification output; the repository document uses public-safe qualification labels.

All five chemically distinct ligands succeeded, yielding 15 authoritative pose sets. Temporary artifacts and structured JSON/CSV qualification outputs were kept outside the repository.

| Ligand | Modes | Features per mode | Per-mode class counts (AROMATIC/HBA/HBD/HYDROPHOBIC/NEG/POS) |
| --- | ---: | ---: | --- |
| QL-01 | 3 | 9 | 1 / 1 / 1 / 6 / 0 / 0 |
| QL-02 | 3 | 11 | 2 / 1 / 1 / 7 / 0 / 0 |
| QL-03 | 3 | 11 | 2 / 2 / 1 / 6 / 0 / 0 |
| QL-04 | 3 | 15 | 2 / 1 / 1 / 11 / 0 / 0 |
| QL-05 | 3 | 18 | 3 / 2 / 2 / 9 / 1 / 1 |

Feature identities and inventories were identical across all three modes of every ligand. Their spatial matches changed with pose, as intended.

## Threshold sensitivity

All 105 unordered pose pairs were evaluated at every threshold (420 distance-only comparisons); the 15 same-ligand rows are a complete set rather than selected examples.

| Distance (Å) | Same-ligand median matches (range) | Same-ligand median overlap (range) | Cross-ligand median matches (range) | Cross-ligand median overlap (range) |
| ---: | --- | --- | --- | --- |
| 0.75 | 2 (0–11) | 0.182 (0–0.733) | 2 (0–7) | 0.154 (0–0.500) |
| 1.00 | 3 (1–13) | 0.273 (0.091–0.867) | 3 (0–7) | 0.273 (0–0.500) |
| 1.50 | 5 (1–14) | 0.364 (0.091–0.933) | 5 (0–9) | 0.400 (0–0.692) |
| 2.00 | 6 (2–14) | 0.455 (0.182–0.933) | 6 (1–11) | 0.462 (0.069–0.700) |

The expected monotonic sensitivity is substantial, so a universal threshold is not frozen. The method is usable only with the threshold shown alongside every result. A future use case and external benchmark should choose any operational threshold.

At 1.5 Å, same-ligand mode-pair overlaps ranged from 0.091 to 0.933 even though inventories were identical. For example, QL-02 mode 1 versus mode 3 matched 1/11 features, while QL-04 mode 2 versus mode 3 matched 14/15. This demonstrates that inventory equality is not being substituted for spatial agreement.

## Aromatic orientation sensitivity

At a 1.5 Å center threshold, orientation was evaluated for all 105 pose pairs (315 comparisons):

| Angular tolerance | Comparisons changed from distance-only | Total matches removed |
| ---: | ---: | ---: |
| 15° | 44 | 50 |
| 30° | 10 | 10 |
| 45° | 2 | 2 |

Normals were stable and sign-invariant, but the available dataset does not establish that any tolerance improves biological interpretability. No aromatic-orientation criterion is frozen for initial production use.

## Descriptive relationship to other evidence

The dataset contains low-Morgan, different-framework pairs with relatively high threshold-dependent pharmacophore overlap. At 1.5 Å, QL-02 mode 1 versus QL-04 mode 2 had Morgan Tanimoto 0.093, different exact and generic Murcko frameworks, and 9 matches across 11 and 15 features (overlap 0.692; matched-center RMSD 0.807 Å). This is a descriptive spatial observation only, not a claim of a successful scaffold hop, equivalent activity, or common binding mode.

The comparison also distinguishes equal feature counts from geometry: QL-03 mode 2 and QL-02 mode 3 both contain 11 features but match only 1 at 1.5 Å (overlap 0.091).

Pharmacophores remain independent of ProLIF. The temporary run did not produce qualified ProLIF fingerprints, so no feature↔contact atom cross-reference or pharmacophore-versus-interaction comparison is claimed. Such a cross-reference may later be descriptive only and must use shared authoritative ligand atoms.

## Performance

Measured over the 15 pose extractions and 420 distance comparisons on the qualification host:

| Operation | Median (s) | Range (s) |
| --- | ---: | ---: |
| Pose-resolved reconstruction | 0.010214 | 0.009075–0.031543 |
| RDKit feature extraction | 0.014538 | 0.012582–0.023984 |
| Geometry generation | 0.002831 | 0.001691–0.024406 |
| Feature matching | 0.000126 | 0.000087–0.000466 |
| Scientific hashing | 0.000237 | 0.000197–0.000819 |

These measurements do not justify a worker, daemon, or cache. No cache was added. A deterministic scientific hash is available for a future cache and includes schema, template/pose hashes, explicit mode, v2 mapping schema, RDKit and feature-definition versions, canonical mapping, geometry policy, and canonical features; it excludes timings and paths.

## Manual scientific review

Representative records were checked against authoritative SDF atoms and mapped pose coordinates. Carbonyl and ether oxygens produced HBA centers at the mapped atoms; amide N/O and aromatic ring features were assigned consistently with the frozen factory; aromatic centroids lay at ring atom centroids and normals were unit length; carboxyl and tertiary-amine ionizable features retained zero actual formal charge where applicable; no feature referenced an incorrect pose atom; and no exact same-subtype hydrophobe duplicate was present. The observed tertiary-N donor and carboxylic-acid acceptor behavior is the installed RDKit definition described above, not a molecule-specific patch.

## Limitations and future work

- Protonation, tautomer populations, solvation, receptor flexibility, and water-mediated recognition are unresolved.
- RDKit BaseFeatures semantics describe possible feature patterns and may include protonation-dependent capabilities.
- HBA/HBD directions are unavailable; aromatic orientation remains optional.
- Docking poses and Vina energies are predictions, not experimental binding evidence.
- Comparison requires a verified common receptor coordinate frame and does not align ligands.
- Thresholds are qualification parameters, not universal biological cutoffs.
- No ranking, composite score, decision boundary, or automatic interpretation label exists.
- Direct receptor-frame features are interpretable and fast; n-point pharmacophore fingerprints are not recommended until a larger external validation demonstrates a specific retrieval need that direct matching cannot satisfy.

Batch 3C UI integration is scientifically justified only if it exposes raw feature records, explicit thresholds, compatibility/failure states, and these limitations. It must not convert the result into an opaque pharmacophore or design score.
