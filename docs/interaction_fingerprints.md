# Pose-specific interaction fingerprints

MolOptima Design Logic v1 derives an optional interaction fingerprint from one
immutable Vina pose. Docking writes the validated
`moloptima-interaction-analysis-input-v1` contract; a separate Python process
running the frozen ProLIF 2.2.3 environment consumes it. ProLIF is neither
imported by nor required for docking. Missing runtimes, corrupt caches, and
analysis failures therefore leave successful docking results valid.

New docking runs persist the exact Open Babel PDBQT bytes supplied to Vina next
to the immutable SDF template. `moloptima-interaction-analysis-input-v2` and
`moloptima-template-pose-atom-mapping-v2` map SDF atoms to that input PDBQT at
preparation time using the unchanged conformer coordinates, retain explicit
polar-hydrogen parent bonds from the SDF, and then require Vina MODEL atom
order, serials, names, elements, and AutoDock types to match. This direct
identity outranks geometry when a heavy-atom graph has automorphisms. Historical
v1 artifacts remain v1 and are never reinterpreted as v2.

The v1 mapping was chemically validated but still selected among graph
automorphisms with a geometry fit after docking. That is insufficient for atom
identity: an equally valid automorphism can exchange chemically equivalent
atoms and attach a retained polar hydrogen to the wrong template atom. V2
therefore records identity before docking and propagates it forward. The
isolated runner rereads the persisted input PDBQT and verifies its SHA-256
before accepting any v2 request.

The supported configuration is fixed to `Hydrophobic`, `HBDonor`,
`HBAcceptor`, `PiStacking`, `Anionic`, `Cationic`, `CationPi`, `PiCation`, and
`VdWContact`. Standard amino-acid chemistry is reconstructed per complete
residue with ProLIF's standard templates; coordinates and available polar
hydrogens come from the authoritative prepared PDBQT. The runner does not guess
bonds across the whole receptor.

Each atom-level ProLIF occurrence is retained as a
`moloptima-raw-interaction-record-v1` record, including native geometry when
the engine supplies it. Direction is normalized relative to the ligand:
`ligand_donor`, `ligand_acceptor`, `ligand_cation`, `ligand_anion`, or
`ligand_pi`. Symmetric interactions have no direction.

The canonical residue feature syntax is:

`chain:RESNAME:resnum[icode]:InteractionType[:ligand_direction]`

Tokens preserve chain and insertion-code identity. They contain no geometry.
All raw contacts remain available, while the binary fingerprint contains each
token once in sorted order. The artifact schema is
`moloptima-interaction-fingerprint-v1`; its deterministic hash includes all
scientific content, including raw contacts, canonical tokens, mapping schema,
interaction configuration, and frozen runtime provenance. It excludes only
timing, cache, and process-diagnostic fields. Cache reads recompute this hash;
an invalid entry is ignored and recomputed. A valid cache hit does not launch
the isolated runtime.

Similarity is binary Jaccard, `|A ∩ B| / |A ∪ B|`, over unique tokens. One
empty fingerprint compared with a nonempty fingerprint is valid and equals
zero. Two genuinely empty fingerprints return `null` with `both_empty` rather
than implying perfect similarity. Missing or failed analysis is also `null`.
Comparisons require strict equality of receptor identity and SHA, pocket
policy, fingerprint and mapping schemas, interaction configuration, runner,
and scientific runtime versions.

Derived artifacts are cached atomically below the per-user MolOptima runtime
root. The cache identity includes the receptor, template, pose, mapping,
runner, interaction configuration, and scientific package versions. Invalid or
corrupt entries are recomputed. The cache is never read by docking.

Every v1 result states that protonation is not scientifically resolved,
interactions are predictions from computational poses rather than experimental
evidence, absence is not proof of physical absence, pose uncertainty is not
quantified, and metal/cofactor interaction typing is unsupported. Fingerprints
are pose-specific; no multi-pose consensus, occupancy, score weighting, or
structural/ADMET combination is defined in this version.
