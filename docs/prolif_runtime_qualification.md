# ProLIF isolated runtime qualification

MolOptima runs ProLIF in a separate Python process. ProLIF is intentionally not
installed in the main `molecule-intelligence` environment.

## Qualified Windows runtime

The frozen development contract is recorded in
`resources/prolif/runtime_manifest.json`. The current qualified versions are:

- Python 3.11.17
- ProLIF 2.2.3
- RDKit 2026.09.1
- MDAnalysis 2.10.0
- NumPy 2.4.6
- SciPy 1.17.1

The full direct dependency set is retained in the runtime manifest. The runner
schema is `moloptima-prolif-runner-request-v1`, and the packaged runner is
verified against its manifest SHA-256 before use.

For an unbundled developer environment, configure the interpreter through the
existing environment variable rather than adding a machine-specific path to
source code:

```powershell
$env:MOLOPTIMA_PROLIF_PYTHON = "$env:USERPROFILE\miniforge3\envs\moloptima-prolif-qual\python.exe"
```

The Windows runtime is qualified for both development override and packaged use
(`qualified_packaged_windows`). Build the ignored staging artifact with:

```powershell
python scripts\build_prolif_runtime_windows.py --source-prefix C:\path\to\moloptima-prolif-qual
```

The generated runtime remains outside Git at
`desktop/runtime/prolif/python/`. Electron's existing `afterPack` hook copies it
to installed `resources/runtime/prolif/python/`; the application manifest then
resolves `../runtime/prolif/python/python.exe` relative to the installed app
root. No Conda activation or `MOLOPTIMA_PROLIF_PYTHON` override is required in a
packaged installation. Runtime binaries, DLLs, package data, and generated
license inventory must not be committed.

The build validates exact versions and layout, gathers installed license files,
removes caches/build residue, and scans binary and text content for private
machine prefixes. Conda's `Scripts/conda-unpack-script.py` is retained as
documented relocation metadata; any matching prefix outside that exact file is
an actionable packaging failure.

For relocation and scientific equivalence qualification, run
`scripts\qualify_packaged_prolif_runtime.py --help`. The harness compares the
same immutable request under the external qualified interpreter and the
manifest-resolved packaged interpreter, excluding timing metadata only.

## Resolution and failure behavior

Successful version qualification is reused only for the life of the backend
process. The descriptor cache is invalidated by a change to manifest content,
the resolved interpreter path or file metadata, the runner path or file
metadata, or the runtime invocation configuration. Scientific fingerprints are
not stored in this descriptor cache and retain their existing receptor, pose,
mapping, schema, runner, and artifact-hash identities.

The isolated-runner timeout remains 300 seconds. Missing, mismatched, failed, or
timed-out runtimes fail closed: interaction evidence is unavailable, other
Design Logic evidence remains usable, and no main-environment or approximate
interaction fallback is attempted.

## Batch 4B performance qualification

On the qualified Windows development machine, uncached runtime resolution took
2.821 seconds and a process-local reuse took 0.003 seconds. For the real
15-pose qualification set, isolated subprocess startup plus execution ranged
from 2.687 to 3.094 seconds; the runner's measured fingerprint work ranged from
0.114 to 0.189 seconds. A true one-reference-plus-five-comparison evidence
request had a 9.889-second median across five runs (7.558–12.621 seconds).

These numbers qualify the development setup rather than establish a portable
performance guarantee. Process startup and repeated workspace/input handling
remain the dominant costs; the 300-second timeout therefore did not require a
change. A persistent worker or broader scientific-result cache was not added.
