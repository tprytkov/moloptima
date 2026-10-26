# Packaged receptor-repair runtime third-party notices

The Windows receptor-repair runtime is produced from the frozen `win-64`
environment in `environment-win-64.yml`. The build copies license files
provided by installed Conda packages and Python distributions into
`THIRD_PARTY_LICENSES/` and writes a machine-readable
`THIRD_PARTY_LICENSES.json` inventory beside this notice.

The directly qualified components report these licenses in installed package
metadata:

| Component | Version | Reported license |
| --- | --- | --- |
| CPython | 3.11.16 | Python-2.0 |
| PDBFixer | 1.12.0 | MIT |
| OpenMM | 8.6.1 | LGPL-3.0-or-later |

This summary is informational. Copied upstream license texts are the
authoritative redistribution notices. Native and transitive dependencies are
included in the generated inventory rather than silently omitted.

