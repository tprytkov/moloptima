# Packaged ProLIF runtime third-party notices

The Windows ProLIF runtime is produced from the frozen `win-64` environment in
`environment-win-64.yml`. The build copies the license files supplied by every
installed Conda package and Python distribution into
`THIRD_PARTY_LICENSES/`, and writes a machine-readable
`THIRD_PARTY_LICENSES.json` inventory beside this notice.

The directly qualified scientific components report these licenses in their
installed package metadata:

| Component | Version | Reported license |
| --- | --- | --- |
| CPython | 3.11.17 | Python-2.0 |
| ProLIF | 2.2.3 | Apache-2.0 |
| RDKit | 2026.09.1 | BSD-3-Clause |
| MDAnalysis | 2.10.0 | LGPL-3.0-or-later |
| NumPy | 2.4.6 | BSD-3-Clause |
| SciPy | 1.17.1 | BSD three-clause text in installed metadata |
| pandas | 3.0.6 | BSD-3-Clause |
| networkx | 3.6.1 | BSD-3-Clause |
| psutil | 7.2.2 | BSD-3-Clause |
| dill | 0.4.1 | BSD-3-Clause |
| gemmi | 0.7.5 | MPL-2.0 |
| multiprocess | 0.70.19 | BSD-3-Clause |
| tqdm | 4.70.1 | MPL-2.0 AND MIT |

This summary is informational. The copied upstream license texts are the
authoritative redistribution notices. Material native and transitive
dependencies are included in the generated inventory rather than being
silently omitted from attribution.
