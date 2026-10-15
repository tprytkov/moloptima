"""Compare one immutable ProLIF request across external and packaged runtimes."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from molecular_prioritization.interaction_fingerprints import (  # noqa: E402
    PYTHON_ENV,
    resolve_prolif_runtime,
)


def _run(python: Path, runner: Path, request: Path, output: Path) -> tuple[dict[str, object], float]:
    started = time.perf_counter()
    environment = os.environ.copy()
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    completed = subprocess.run(
        [str(python), str(runner), "--request", str(request), "--output", str(output)],
        capture_output=True,
        text=True,
        env=environment,
        shell=False,
        timeout=300,
    )
    elapsed = time.perf_counter() - started
    if completed.returncode != 0:
        raise RuntimeError(f"runner failed: {completed.stderr.strip()}")
    return json.loads(output.read_text(encoding="utf-8")), elapsed


def _meaningful(payload: dict[str, object]) -> dict[str, object]:
    return {key: value for key, value in payload.items() if key != "performance_seconds"}


def _prepare_request(
    source: Path,
    destination: Path,
    *,
    ligand_template: Path | None,
    receptor_topology: Path | None,
    prepared_receptor: Path | None,
) -> Path:
    payload = json.loads(source.read_text(encoding="utf-8"))
    if payload.get("schema_version") == "moloptima-prolif-runner-request-v1":
        return source
    if payload.get("schema_version") not in {
        "moloptima-interaction-analysis-input-v1",
        "moloptima-interaction-analysis-input-v2",
    }:
        raise RuntimeError("request is neither a ProLIF runner request nor an analysis-input contract")
    if ligand_template is None or receptor_topology is None or prepared_receptor is None:
        raise RuntimeError("raw analysis input requires ligand/receptor artifact paths")
    request = {
        "schema_version": "moloptima-prolif-runner-request-v1",
        "analysis_input": payload,
        "ligand_template_path": str(ligand_template.resolve()),
        "receptor_topology_path": str(receptor_topology.resolve()),
        "prepared_receptor_path": str(prepared_receptor.resolve()),
    }
    destination.write_text(json.dumps(request, sort_keys=True), encoding="utf-8")
    return destination


def compare_runtimes(
    *, external_python: Path, installed_application_root: Path, request: Path,
    ligand_template: Path | None = None, receptor_topology: Path | None = None,
    prepared_receptor: Path | None = None,
) -> dict[str, object]:
    environment_without_override = {
        key: value for key, value in os.environ.items() if key.upper() != PYTHON_ENV
    }
    packaged_started = time.perf_counter()
    packaged = resolve_prolif_runtime(
        application_root=installed_application_root,
        environ=environment_without_override,
    )
    cold_resolution = time.perf_counter() - packaged_started
    warm_started = time.perf_counter()
    repeated = resolve_prolif_runtime(
        application_root=installed_application_root,
        environ=environment_without_override,
    )
    warm_resolution = time.perf_counter() - warm_started
    if packaged != repeated or packaged.python_source != "packaged":
        raise RuntimeError("packaged runtime resolution did not remain stable")

    runner = installed_application_root / "resources" / "prolif" / "prolif_runner.py"
    with tempfile.TemporaryDirectory(prefix="moloptima-prolif-equivalence-") as temporary:
        temporary_root = Path(temporary)
        runner_request = _prepare_request(
            request,
            temporary_root / "request.json",
            ligand_template=ligand_template,
            receptor_topology=receptor_topology,
            prepared_receptor=prepared_receptor,
        )
        external_payload, external_seconds = _run(
            external_python, runner, runner_request, temporary_root / "external.json"
        )
        packaged_payload, packaged_seconds = _run(
            packaged.python, runner, runner_request, temporary_root / "packaged.json"
        )
    equivalent = _meaningful(external_payload) == _meaningful(packaged_payload)
    if not equivalent:
        raise RuntimeError("packaged runtime scientific payload differs from the qualified external runtime")
    sanity_contacts = [
        record for record in packaged_payload.get("raw_interaction_records", [])
        if isinstance(record, dict) and record.get("interaction_type") == "HBDonor"
    ]
    return {
        "schema_version": "moloptima-packaged-prolif-equivalence-v1",
        "status": "PASS",
        "packaged_resolution_source": packaged.python_source,
        "versions": dict(packaged.versions),
        "cold_resolution_seconds": cold_resolution,
        "warm_resolution_seconds": warm_resolution,
        "external_runner_seconds": external_seconds,
        "packaged_runner_seconds": packaged_seconds,
        "raw_interaction_count": packaged_payload.get("raw_interaction_count"),
        "unique_token_count": packaged_payload.get("unique_token_count"),
        "canonical_tokens": packaged_payload.get("canonical_tokens"),
        "sanity_hbond_contacts": sanity_contacts,
        "scientific_payload_equivalent": equivalent,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--external-python", type=Path, required=True)
    parser.add_argument("--installed-application-root", type=Path, required=True)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--ligand-template", type=Path)
    parser.add_argument("--receptor-topology", type=Path)
    parser.add_argument("--prepared-receptor", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = compare_runtimes(
        external_python=args.external_python,
        installed_application_root=args.installed_application_root,
        request=args.request,
        ligand_template=args.ligand_template,
        receptor_topology=args.receptor_topology,
        prepared_receptor=args.prepared_receptor,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
