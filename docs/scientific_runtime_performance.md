# Scientific runtime performance and package qualification

## Scope

This Batch 4D qualification profiles the frozen Batch 4C scientific runtimes and
removes generated Python bytecode from Windows package output. It does not change
model weights, package versions, scientific thresholds, scientific algorithms,
or result-cache identities.

## ProLIF runtime resolution

The Batch 4C installed-tree observation was 35.3239 seconds cold and 0.00549
seconds warm. Five repeated Batch 4D measurements against the same packaged tree
gave a cold median of 5.2052 seconds (5.1938 minimum, 6.7191 maximum) and a warm
process-cache median of 0.003716 seconds (0.003687 minimum, 0.003845 maximum).

Median cold-stage timings were:

| Stage | Seconds |
| --- | ---: |
| Application/resource-root discovery | 0.000366 |
| Manifest load | 0.000214 |
| Candidate construction | 0.001464 |
| Candidate existence checks | 0.000176 |
| Manifest canonicalization | 0.000054 |
| Interpreter/runner metadata | 0.000111 |
| Runner SHA-256 validation | 0.000208 |
| Qualification identity assembly | 0.000632 |
| Subprocess package-import/version probe | 5.200734 |
| Probe-result validation | 0.001245 |

There is no recursive application/runtime traversal and no broad runtime hash in
the resolution path. The manifest and the 24 KB runner are the only content
hashed there. The cold path is the fail-closed subprocess import/version probe.
The earlier 35-second value was therefore an extreme cold-file/DLL-loading
observation within that probe, not manifest discovery. Antivirus attribution was
not measured and is not asserted.

Fresh-process median timings were 0.0422 seconds for Python startup, 0.1818 for
`rdkit`, 2.9576 for `MDAnalysis`, and 5.1830 for `prolif`. First-touch samples
reached 13.58 seconds for MDAnalysis and 12.95 seconds for ProLIF. Skipping the
probe or trusting metadata alone was rejected because it would weaken the
current import-based, fail-closed qualification. A persistent worker was not
introduced.

## Design Logic synthesis

Five repetitions used the same retained 20-molecule job, `gen_3389` as the
reference, mode 1, and the same ordered comparison set. The retained job no
longer has its ligand-template artifacts, so interaction and pharmacophore
states are typed unavailable; these measurements qualify orchestration cost,
not fresh scientific calculation.

| Selection | Total median | Workspace/cached layers | Pharmacophore stage | Evidence assembly | Serialization |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 + 1 | 0.051872 s | 0.037372 s | 0.014674 s | 0.000052 s | 0.000112 s |
| 1 + 4 | 0.056876 s | 0.039120 s | 0.017146 s | 0.000072 s | 0.000206 s |
| 1 + 5 | 0.060846 s | 0.040596 s | 0.018553 s | 0.000081 s | 0.000247 s |

Reference interaction state and reference pharmacophore are already computed
once per request. No cross-pose or cross-receptor reuse occurs. Additional
request-scoped caching was rejected because the observed bounded orchestration
cost is small and the only repeated work is low-cost manifest/file identity and
job metadata access.

## Runtime footprint before trimming

The staged runtime tree contained 14,873,298,846 bytes and 167,420 files:

| Runtime | Bytes | Files |
| --- | ---: | ---: |
| Chemprop regression | 5,458,883,605 | 40,427 |
| GMC-MPNN BBB | 5,329,489,892 | 40,443 |
| Main backend/ChemBERTa runtime | 2,686,044,328 | 63,160 |
| ProLIF | 1,398,881,021 | 23,390 |

The installed tree contains the same staged runtime bytes before packaging
filters. Native resources are much smaller: Open Babel 5,432,508 bytes, Vina
782,186 bytes, and receptor-preparation manifest content 321 bytes. Meeko uses
2,049,104 bytes in the main runtime. Gemmi uses 5,341,076 bytes in the main
runtime and 5,444,063 bytes in ProLIF.

Packaged model-release archives are reported separately and are not considered
redundant: ChemBERTa 163,746,656 bytes, GMC-MPNN BBB 73,010,375 bytes, and
Chemprop regression 22,141,190 bytes (258,898,221 bytes total).

The 10.8 GB ADMET environment footprint is primarily two separate PyTorch
stacks. Chemprop's `torch` tree is 4,684,656,156 bytes, including 3,445,968,990
bytes of CUDA/cuDNN-named binaries. GMC's `torch` tree is 4,529,585,792 bytes,
including 3,419,839,114 bytes of CUDA/cuDNN-named binaries. Their large binaries
are mostly different versions/builds, not identical files.

Hashing 1,445 selected Python/native dependency binaries found 168,000,544
theoretical duplicate bytes across runtime boundaries. This is an opportunity
estimate only; no environment merging or cross-environment linking was adopted.

## Adopted package optimization

The runtime copy contained 936,792,777 bytes in 44,545 generated `.pyc` files.
All corresponding scientific source packages remain present; the few pytest-tag
cache entries without a simple filename match are test-run caches, not runtime
authority. Electron's `afterPack` copy now excludes `.pyc`, `.pyo`, and
`__pycache__`, and the packaged backend sets `PYTHONDONTWRITEBYTECODE=1`.
Staged environments are not modified.

After rebuilding only `win-unpacked`:

| Metric | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Complete unpacked app | 15,422,250,408 B | 14,485,457,963 B | 936,792,445 B (6.074%) |
| Runtime tree | 14,873,298,846 B | 13,936,506,069 B | 936,792,777 B (6.298%) |
| Complete app files | 167,595 | 123,050 | 44,545 (26.579%) |

The rebuilt package contains zero `.pyc`, `.pyo`, and `__pycache__` entries.
Main, Chemprop, GMC, and ProLIF import probes passed from the bytecode-free
package. A real packaged ProLIF request produced 27 raw contacts and 13 canonical
tokens; raw records, tokens, fingerprint SHA, mapping schema, and atom provenance
were exactly equivalent to the external frozen runtime. A repeated request was
a cache hit.

Name-based review also found 266,028,146 bytes under tests/docs/examples paths.
Those files were not removed because scientific packages can carry required data
under ambiguous directory names. CPU-only PyTorch environments, environment
consolidation, RDKit data trimming, and zip/single-file packaging were also
rejected for this batch because each requires separate scientific qualification.

## Build and compression decisions

The bytecode-free unpacked build completed in 496.07 seconds. The previous
maximum-compression NSIS payload was 5,147,015,774 bytes and took 4,114.25
seconds. A second multi-gigabyte compression run was not considered proportionate
in this batch, so `-mx=9` behavior and Electron's compression configuration were
not changed. Installer-size savings are not claimed until a future installer is
actually rebuilt and measured.

The current ProLIF builder always rebuilds when invoked; it has no content-
identity reuse. A future reuse record would need to bind the environment spec,
manifest, runner, build script, license inputs, and trimming policy. That design
was documented but not implemented.

## Reproducible tools

`scripts/profile_scientific_runtime.py` reports structured resolution, import,
warm-cache, and optional Design Logic timings without timing pass/fail thresholds.
`scripts/audit_runtime_sizes.py` reports runtime sizes, file counts, largest
directories/files, model weights, trimming candidates, and hash-confirmed binary
duplication. Both tools are read-only unless the caller explicitly supplies an
output file.

## Remaining limitations

- Cold ProLIF and ADMET startup remains dominated by native/scientific imports.
- The two ADMET environments retain approximately 6.87 GB of CUDA/cuDNN-named
  libraries; moving to CPU-qualified stacks would be a separate model-runtime
  qualification project.
- No ProLIF daemon, subprocess pool, or environment consolidation was added.
- The NSIS payload was not rebuilt, so compressed-installer savings are unknown.
- Automated Electron launch was blocked by the execution policy; packaged
  interpreter imports and scientific requests passed, while the prior Batch 4C
  hidden-app smoke remains the latest full Electron smoke.
- Human-style GUI Alt+F4 close remains not independently verified.
