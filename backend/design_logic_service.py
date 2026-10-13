"""Job-scoped orchestration for the Design Logic interaction workspace."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Callable, Mapping

from fastapi import HTTPException, status
from rdkit import Chem
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

from backend import receptor_store, services
from molecular_prioritization.chemical_space import nearest_neighbors
from molecular_prioritization.interaction_analysis_input import (
    InteractionAnalysisInputError,
    build_interaction_analysis_input,
)
from molecular_prioritization.interaction_fingerprints import (
    InteractionAnalysisError,
    analyze_docking_pose_interactions,
    compare_interaction_fingerprints,
    get_cached_docking_pose_interactions,
)
from molecular_prioritization.scaffolds import organize_scaffolds


WORKSPACE_SCHEMA = "moloptima-design-logic-workspace-v1"
MAX_COMPARISON_MOLECULES = 50
MAX_MATRIX_COLUMNS = 12
_RESIDUE_NUMBER = re.compile(r"^(-?\d+)(.*)$")


def partition_interaction_tokens(
    reference: Mapping[str, object] | None,
    comparison: Mapping[str, object] | None,
) -> dict[str, list[str]]:
    """Return deterministic neutral token partitions for two available fingerprints."""

    reference_tokens = set(reference.get("canonical_tokens", [])) if reference else set()
    comparison_tokens = set(comparison.get("canonical_tokens", [])) if comparison else set()
    return {
        "shared": sorted(reference_tokens & comparison_tokens),
        "reference_only": sorted(reference_tokens - comparison_tokens),
        "comparison_only": sorted(comparison_tokens - reference_tokens),
    }


def workspace(
    job_id: str,
    reference_molecule_id: str,
    reference_mode: int,
    comparison_mode: int,
    limit: int = MAX_COMPARISON_MOLECULES,
    *,
    cached_loader: Callable[..., dict[str, object] | None] = get_cached_docking_pose_interactions,
) -> dict[str, object]:
    """Assemble a bounded workspace from cached pose fingerprints only."""

    result = services.get_result(job_id)
    records = services._load_molecule_collection_records(str(result["upload_id"]))
    rows = [dict(row) for row in result.get("results", [])]
    rows_by_id = {str(row.get("molecule_id")): row for row in rows}
    if reference_molecule_id not in rows_by_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reference molecule is not in this job.")
    structural = nearest_neighbors(records, reference_molecule_id, max(0, len(records) - 1))
    similarities = {reference_molecule_id: 1.0}
    similarities.update({str(item["molecule_id"]): item["similarity"] for item in structural["neighbors"]})
    scaffold_payload = organize_scaffolds(records)
    scaffold_by_id = {
        str(member["molecule_id"]): group["scaffold_id"]
        for group in scaffold_payload["scaffolds"]
        for member in group["members"]
    }
    reference_scaffold = scaffold_by_id.get(reference_molecule_id)

    reference_state = _fingerprint_state(
        job_id, rows_by_id[reference_molecule_id], reference_mode, cached_loader=cached_loader,
    )
    candidates = sorted(
        rows,
        key=lambda row: (-float(similarities.get(str(row.get("molecule_id")), -1)), str(row.get("molecule_id"))),
    )[:max(1, min(int(limit), MAX_COMPARISON_MOLECULES))]
    points = []
    for row in candidates:
        molecule_id = str(row.get("molecule_id"))
        mode = reference_mode if molecule_id == reference_molecule_id else comparison_mode
        fingerprint_state = (
            reference_state if molecule_id == reference_molecule_id
            else _fingerprint_state(job_id, row, mode, cached_loader=cached_loader)
        )
        comparison = _comparison_state(reference_state, fingerprint_state)
        docking = dict(row.get("docking_result") or {})
        mode_row = next((item for item in docking.get("modes", []) if int(item.get("mode", -1)) == mode), {})
        points.append({
            "molecule_id": molecule_id,
            "display_name": str(row.get("original_molecule_id") or molecule_id),
            "canonical_smiles": str(row.get("canonical_smiles") or ""),
            "source": str(row.get("source_filename") or row.get("source_type") or "Imported"),
            "scaffold_id": scaffold_by_id.get(molecule_id),
            "same_scaffold_as_reference": (
                scaffold_by_id.get(molecule_id) == reference_scaffold
                if scaffold_by_id.get(molecule_id) is not None and reference_scaffold is not None
                else None
            ),
            "mode": mode,
            "vina_affinity_kcal_mol": mode_row.get("affinity_kcal_mol"),
            "structural_similarity": similarities.get(molecule_id),
            "fingerprint_status": fingerprint_state["status"],
            "fingerprint_message": fingerprint_state.get("message", ""),
            "fingerprint": fingerprint_state.get("fingerprint"),
            "visualization": _visualization_contract(job_id, molecule_id, mode, docking, fingerprint_state),
            "interaction_similarity": comparison.get("interaction_fingerprint_similarity"),
            "interaction_similarity_status": comparison["status"],
            "token_partition": partition_interaction_tokens(
                reference_state.get("fingerprint"), fingerprint_state.get("fingerprint"),
            ) if reference_state["status"] == fingerprint_state["status"] == "available" else None,
        })

    coverage = {
        "total": len(points),
        "available": sum(point["fingerprint_status"] == "available" for point in points),
        "not_analyzed": sum(point["fingerprint_status"] == "not_analyzed" for point in points),
        "incompatible": sum(point["interaction_similarity_status"] == "incompatible" for point in points),
        "failed": sum(point["fingerprint_status"] not in {"available", "not_analyzed", "missing_pose"} for point in points),
        "missing_pose": sum(point["fingerprint_status"] == "missing_pose" for point in points),
    }
    return {
        "schema_version": WORKSPACE_SCHEMA,
        "job_id": job_id,
        "reference_molecule_id": reference_molecule_id,
        "reference_mode": reference_mode,
        "comparison_mode": comparison_mode,
        "reference_fingerprint_status": reference_state["status"],
        "coverage": coverage,
        "points": points,
        "matrix": _interaction_matrix(points),
        "metadata": {
            "structural_similarity": structural["metadata"],
            "interaction_similarity": "Jaccard over unique canonical ProLIF interaction tokens",
            "comparison_policy": "explicit_vina_mode_no_substitution",
            "bounded_limit": MAX_COMPARISON_MOLECULES,
            "matrix_column_limit": MAX_MATRIX_COLUMNS,
        },
    }


def ligand_depiction(smiles: str, width: int = 420, height: int = 300) -> dict[str, object]:
    """Return a deterministic vector depiction and exact RDKit atom draw coordinates."""

    molecule = Chem.MolFromSmiles(str(smiles or "").strip())
    if molecule is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Invalid or unavailable ligand structure for interaction-map depiction.",
        )
    rdDepictor.Compute2DCoords(molecule)
    drawer = rdMolDraw2D.MolDraw2DSVG(width, height)
    drawer.drawOptions().clearBackground = False
    drawer.DrawMolecule(molecule)
    atom_positions = []
    for atom in molecule.GetAtoms():
        point = drawer.GetDrawCoords(atom.GetIdx())
        atom_positions.append({
            "atom_index": atom.GetIdx(),
            "element": atom.GetSymbol(),
            "x": round(float(point.x), 4),
            "y": round(float(point.y), 4),
        })
    drawer.FinishDrawing()
    return {
        "schema_version": "moloptima-design-logic-depiction-v1",
        "width": width,
        "height": height,
        "svg": drawer.GetDrawingText(),
        "atom_positions": atom_positions,
        "orientation": "deterministic_rdkit_2d_depiction",
        "placement_caveat": (
            "Residue placement is schematic and does not represent physical 3D distance."
        ),
    }


def analyze_pose(job_id: str, molecule_id: str, mode: int) -> dict[str, object]:
    """Analyze exactly one explicitly requested pose through the isolated runtime."""

    result = services.get_result(job_id)
    row = next((item for item in result.get("results", []) if str(item.get("molecule_id")) == molecule_id), None)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Molecule is not in this job.")
    state = _fingerprint_state(job_id, dict(row), mode, analyze=True)
    return {"job_id": job_id, "molecule_id": molecule_id, "mode": mode, **state}


def _fingerprint_state(
    job_id: str,
    row: Mapping[str, object],
    mode: int,
    *,
    analyze: bool = False,
    cached_loader: Callable[..., dict[str, object] | None] = get_cached_docking_pose_interactions,
) -> dict[str, object]:
    try:
        contract, paths = _analysis_context(job_id, row, mode)
        fingerprint = (
            analyze_docking_pose_interactions(contract, **paths)
            if analyze else cached_loader(contract)
        )
        if fingerprint is None:
            return {"status": "not_analyzed", "message": "This explicit pose has not been analyzed."}
        return {"status": "available", "fingerprint": fingerprint, "cache_status": fingerprint.get("cache_status")}
    except InteractionAnalysisInputError as exc:
        mapped = {
            "ligand_template_missing": "missing_template",
            "pose_parse_failed": "missing_pose",
            "pose_mode_missing": "missing_pose",
        }.get(exc.code, "incompatible")
        return {"status": mapped, "error_code": exc.code, "message": str(exc)}
    except InteractionAnalysisError as exc:
        mapped = {
            "interaction_runtime_unavailable": "runtime_unavailable",
            "interaction_runtime_timeout": "runtime_timeout",
            "interaction_runtime_failed": "runtime_failed",
            "interaction_output_malformed": "malformed",
            "interaction_runtime_incompatible": "incompatible",
            "interaction_input_invalid": "incompatible",
        }.get(exc.code, "runtime_failed")
        return {"status": mapped, "error_code": exc.code, "message": str(exc)}
    except (HTTPException, OSError, ValueError, KeyError) as exc:
        return {"status": "missing_pose", "message": str(getattr(exc, "detail", exc))}


def _visualization_contract(
    job_id: str,
    molecule_id: str,
    mode: int,
    docking: Mapping[str, object],
    fingerprint_state: Mapping[str, object],
) -> dict[str, object]:
    fingerprint = fingerprint_state.get("fingerprint")
    return {
        "schema_version": "moloptima-design-logic-visualization-v1",
        "docking_job_id": job_id,
        "molecule_id": molecule_id,
        "mode": mode,
        "pose_artifact": docking.get("pose_file") or docking.get("pose_path"),
        "pose_sha256": docking.get("pose_sha256"),
        "receptor_id": docking.get("receptor_id"),
        "prepared_receptor_sha256": docking.get("prepared_receptor_sha256"),
        "preparation_id": docking.get("preparation_id"),
        "raw_interaction_count": (
            fingerprint.get("raw_interaction_count", len(fingerprint.get("raw_interaction_records", [])))
            if isinstance(fingerprint, Mapping) else 0
        ),
        "coordinate_policy": "qualified_8_angstrom_complete_residue_pocket",
        "atom_identity_policy": "authoritative_template_pdbqt_vina_and_receptor_serials",
    }


def _analysis_context(job_id: str, row: Mapping[str, object], mode: int) -> tuple[dict[str, object], dict[str, Path]]:
    docking = dict(row.get("docking_result") or {})
    if docking.get("status") != "success":
        raise InteractionAnalysisInputError("pose_parse_failed", "Successful docking output is unavailable.")
    if not any(int(item.get("mode", -1)) == mode for item in docking.get("modes", [])):
        raise InteractionAnalysisInputError("pose_mode_missing", f"Vina mode {mode} is unavailable.")
    job_root = (services.JOB_OUTPUT_DIR / job_id).resolve()
    pose = _job_artifact(job_root, docking.get("pose_path"), "pose")
    template_info = dict(docking.get("ligand_template") or {})
    template = _job_artifact(job_root, template_info.get("artifact_path"), "ligand template")
    template_metadata = _job_artifact(job_root, template_info.get("metadata_path"), "ligand template metadata")
    input_pdbqt = _job_artifact(job_root, template_info.get("input_pdbqt_artifact_path"), "ligand input PDBQT")
    prepared, topology, provenance = _receptor_artifacts(docking)
    contract = build_interaction_analysis_input(
        docking_result=docking,
        ligand_template_path=template,
        ligand_template_metadata_path=template_metadata,
        pose_path=pose,
        mode_number=mode,
        prepared_receptor_pdbqt_path=prepared,
        meeko_input_pdb_path=topology,
        receptor_preparation_provenance_path=provenance,
        ligand_input_pdbqt_path=input_pdbqt,
    )
    return contract, {
        "ligand_template_path": template,
        "receptor_topology_path": topology,
        "prepared_receptor_path": prepared,
        "ligand_input_pdbqt_path": input_pdbqt,
    }


def _job_artifact(root: Path, relative: object, label: str) -> Path:
    path = (root / str(relative or "")).resolve()
    if root not in path.parents or not path.is_file():
        code = "ligand_template_missing" if "template" in label or "input" in label else "pose_parse_failed"
        raise InteractionAnalysisInputError(code, f"Stored {label} artifact is unavailable.")
    return path


def _receptor_artifacts(docking: Mapping[str, object]) -> tuple[Path, Path, Path]:
    receptor_id = str(docking.get("receptor_id") or "")
    expected = str(docking.get("prepared_receptor_sha256") or "")
    resource = receptor_store._resource_dir(receptor_id)
    candidates = list(resource.glob("preparations/*/receptor/prepared_receptor.pdbqt"))
    try:
        candidates.append(receptor_store.prepared_receptor_path(receptor_id))
    except HTTPException:
        pass
    for prepared in candidates:
        if prepared.is_file() and hashlib.sha256(prepared.read_bytes()).hexdigest() == expected:
            topology = prepared.parent / "meeko_input.pdb"
            provenance = prepared.parent / "receptor_preparation.json"
            if topology.is_file() and provenance.is_file():
                return prepared, topology, provenance
    raise InteractionAnalysisInputError(
        "unsupported_receptor_artifact",
        "The exact qualified receptor preparation artifacts are unavailable.",
    )


def _comparison_state(reference: Mapping[str, object], comparison: Mapping[str, object]) -> dict[str, object]:
    if reference["status"] != "available":
        return {"status": "unavailable_reference", "interaction_fingerprint_similarity": None}
    if comparison["status"] != "available":
        return {"status": comparison["status"], "interaction_fingerprint_similarity": None}
    result = compare_interaction_fingerprints(reference["fingerprint"], comparison["fingerprint"])
    if result["status"] == "incompatible_receptor_context":
        result["status"] = "incompatible"
    return result


def _token_sort_key(token: str) -> tuple[object, ...]:
    chain, residue_name, residue_number, interaction, *direction = token.split(":")
    match = _RESIDUE_NUMBER.match(residue_number)
    number = int(match.group(1)) if match else 0
    insertion = match.group(2) if match else residue_number
    return chain, number, insertion, residue_name, interaction, direction[0] if direction else ""


def _interaction_matrix(points: list[dict[str, object]]) -> dict[str, object]:
    available = [point for point in points if point["fingerprint_status"] == "available"][:MAX_MATRIX_COLUMNS]
    features = sorted({
        token for point in available for token in point["fingerprint"].get("canonical_tokens", [])
    }, key=_token_sort_key)
    return {
        "features": features,
        "columns": [{
            "molecule_id": point["molecule_id"],
            "mode": point["mode"],
            "present_tokens": point["fingerprint"].get("canonical_tokens", []),
        } for point in available],
        "ordering": "rows: chain/residue number/interaction; columns: Morgan Tanimoto descending then molecule ID",
    }
