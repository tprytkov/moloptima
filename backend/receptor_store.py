"""File-backed receptor and approved docking-configuration storage."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile, status

from molecular_prioritization.receptor import (
    ReceptorValidationError,
    VinaBoxConfig,
    validate_prepared_receptor,
    validate_receptor_pdb,
)
from molecular_prioritization.receptor_preparation import (
    ReceptorPreparationError,
    prepare_receptor,
    receptor_preparation_runtime_status,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
RECEPTOR_ROOT = PROJECT_ROOT / "app_data" / "receptors"
_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def save_receptor_upload(
    file: UploadFile,
    *,
    receptor_id: str = "",
    display_name: str = "",
) -> dict[str, object]:
    """Create a receptor resource or attach a prepared PDBQT to an existing PDB resource."""

    original_filename = Path(file.filename or "").name
    suffix = Path(original_filename).suffix.lower()
    if suffix not in {".pdb", ".pdbqt"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Receptor upload must be a PDB or prepared PDBQT file.",
        )
    existing_id = receptor_id.strip()
    created_resource = not bool(existing_id)
    if existing_id:
        resource_dir = _resource_dir(existing_id)
        metadata = read_receptor(existing_id)
        if suffix != ".pdbqt":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only a prepared PDBQT may be attached to an existing receptor resource.",
            )
    else:
        existing_id = uuid4().hex
        resource_dir = _resource_dir(existing_id)
        metadata = {
            "receptor_id": existing_id,
            "display_name": display_name.strip() or Path(original_filename).stem,
            "created_at": _timestamp(),
            "original_filename": original_filename,
            "original_pdb": None,
            "prepared_pdbqt": None,
            "source_receptor_sha256": None,
            "docking_receptor_sha256": None,
            "preparation_method": "not_available",
            "preparation_tool": None,
            "preparation_tool_version": None,
            "preparation_warnings": [],
            "preparation_status": "not_prepared",
            "receptor_source": None,
            "structure_inventory": None,
            "bound_ligands": [],
            "configurations": [],
        }
        resource_dir.mkdir(parents=True, exist_ok=False)

    safe_name = _sanitize_filename(original_filename, suffix)
    destination = (
        resource_dir / "source" / safe_name
        if suffix == ".pdb"
        else resource_dir / "prepared" / "receptor.pdbqt"
    )
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This receptor resource already has that receptor artifact.",
        )
    with destination.open("xb") as handle:
        shutil.copyfileobj(file.file, handle)

    try:
        if suffix == ".pdb":
            analysis = validate_receptor_pdb(destination)
            metadata.update({
                "original_filename": original_filename,
                "original_pdb": _relative_to_resource(resource_dir, destination),
                "source_receptor_sha256": analysis["sha256"],
                "source_size_bytes": analysis["size_bytes"],
                "atom_count": analysis["atom_count"],
                "bound_ligands": analysis["bound_ligands"],
                "structure_inventory": analysis["structure_inventory"],
                "visualization_format": "pdb",
                "preparation_warnings": [
                    "Review the receptor inventory and scientific preparation choices before generating PDBQT."
                ],
            })
        else:
            artifact = validate_prepared_receptor(
                destination,
                receptor_id=existing_id,
                source="user_supplied_pdbqt",
                source_filename=original_filename,
            )
            source_digest = hashlib.sha256(destination.read_bytes()).hexdigest()
            metadata.update({
                "original_filename": metadata.get("original_filename") or original_filename,
                "prepared_pdbqt_original_filename": original_filename,
                "prepared_pdbqt": _relative_to_resource(resource_dir, destination),
                "source_receptor_sha256": metadata.get("source_receptor_sha256") or source_digest,
                "docking_receptor_sha256": artifact.prepared_receptor_sha256,
                "docking_size_bytes": artifact.size_bytes,
                "visualization_format": metadata.get("visualization_format") or "pdbqt",
                "preparation_method": "user_supplied_pdbqt",
                "preparation_status": "valid",
                "receptor_source": "user_supplied_pdbqt",
                "preparation_tool": "user_provided",
                "preparation_tool_version": "not_applicable",
                "preparation_warnings": [],
            })
    except ReceptorValidationError as exc:
        if created_resource:
            shutil.rmtree(resource_dir, ignore_errors=True)
        else:
            destination.unlink(missing_ok=True)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    metadata["docking_ready"] = bool(metadata.get("prepared_pdbqt"))
    metadata["visualization_available"] = True
    _write_metadata(resource_dir, metadata)
    return metadata


def preparation_runtime_status() -> dict[str, object]:
    return receptor_preparation_runtime_status()


def prepare_stored_receptor(receptor_id: str, values: dict[str, object]) -> dict[str, object]:
    """Prepare a stored PDB into a new immutable per-run receptor directory."""

    metadata = read_receptor(receptor_id)
    resource_dir = _resource_dir(receptor_id)
    original_relative = metadata.get("original_pdb")
    if not original_relative:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A source PDB is required for MolOptima receptor preparation.",
        )
    original_path = (resource_dir / str(original_relative)).resolve()
    if resource_dir not in original_path.parents or not original_path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored source PDB is missing.")
    preparation_id = uuid4().hex
    output_dir = resource_dir / "preparations" / preparation_id / "receptor"
    try:
        result = prepare_receptor(
            original_path,
            output_dir,
            original_filename=str(metadata.get("original_filename") or original_path.name),
            receptor_id=receptor_id,
            selected_chains=list(values.get("selected_chains") or []),
            water_policy=str(values.get("water_policy") or ""),
            hetero_choices=dict(values.get("hetero_choices") or {}),
            altloc_choices=dict(values.get("altloc_choices") or {}),
            bound_ligand_id=str(values.get("bound_ligand_id") or ""),
        )
    except (ReceptorPreparationError, OSError, ValueError) as exc:
        metadata.update({
            "preparation_status": "failed",
            "preparation_error": str(exc),
            "docking_ready": bool(metadata.get("prepared_pdbqt")),
        })
        _write_metadata(resource_dir, metadata)
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc

    artifact = result["validated_artifact"]
    provenance = result["provenance"]
    metadata.update({
        "prepared_pdbqt": _relative_to_resource(resource_dir, result["prepared_pdbqt"]),
        "docking_receptor_sha256": artifact.prepared_receptor_sha256,
        "docking_size_bytes": artifact.size_bytes,
        "preparation_id": preparation_id,
        "preparation_status": "valid",
        "preparation_error": None,
        "preparation_method": "moloptima_meeko_rigid",
        "preparation_tool": "Meeko",
        "preparation_tool_version": provenance["meeko_version"],
        "preparation_warnings": provenance["warnings"],
        "preparation_provenance": _relative_to_resource(resource_dir, result["provenance_file"]),
        "preparation_sha256sums": _relative_to_resource(resource_dir, result["sha256sums"]),
        "preparation_details": provenance,
        "receptor_source": "moloptima_prepared",
        "docking_ready": True,
        "visualization_available": True,
    })
    _write_metadata(resource_dir, metadata)
    return metadata


def read_receptor(receptor_id: str) -> dict[str, object]:
    resource_dir = _resource_dir(receptor_id)
    path = resource_dir / "metadata.json"
    if not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receptor not found.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored receptor metadata is unreadable.",
        ) from exc
    if not isinstance(payload, dict) or payload.get("receptor_id") != receptor_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored receptor metadata is invalid.",
        )
    return payload


def receptor_structure(receptor_id: str) -> tuple[Path, str]:
    metadata = read_receptor(receptor_id)
    resource_dir = _resource_dir(receptor_id)
    relative = metadata.get("original_pdb") or metadata.get("prepared_pdbqt")
    if not relative:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receptor structure is unavailable.")
    path = (resource_dir / str(relative)).resolve()
    if resource_dir not in path.parents or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receptor structure is missing.")
    return path, "pdb" if path.suffix.lower() == ".pdb" else "pdbqt"


def save_configuration(values: dict[str, object]) -> dict[str, object]:
    receptor_id = str(values.get("receptor_id") or "").strip()
    metadata = read_receptor(receptor_id)
    resource_dir = _resource_dir(receptor_id)
    config_values = dict(values)
    method = str(config_values.pop("center_method", "manual")).strip()
    selected_ligand_id = str(config_values.pop("selected_ligand_id", "") or "").strip()
    if method == "bound_ligand" and selected_ligand_id:
        ligand = next(
            (item for item in metadata.get("bound_ligands", []) if item.get("ligand_id") == selected_ligand_id),
            None,
        )
        if ligand is None:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Selected bound ligand was not found.")
        centroid = ligand["centroid"]
        for name in ("center_x", "center_y", "center_z"):
            if config_values.get(name) is None:
                config_values[name] = centroid[name]
    try:
        config = VinaBoxConfig.from_mapping(config_values)
    except ReceptorValidationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    configuration_id = uuid4().hex
    payload = {
        "configuration_id": configuration_id,
        "receptor_id": receptor_id,
        "center_method": method,
        "selected_ligand_id": selected_ligand_id or None,
        "approved": True,
        "created_at": _timestamp(),
        **config.as_dict(),
    }
    config_dir = resource_dir / "configurations"
    config_dir.mkdir(parents=True, exist_ok=True)
    _write_json(config_dir / f"{configuration_id}.json", payload)
    configurations = list(metadata.get("configurations", []))
    configurations.append(payload)
    metadata["configurations"] = configurations
    metadata["approved_configuration_id"] = configuration_id
    _write_metadata(resource_dir, metadata)
    return payload


def read_configuration(configuration_id: str) -> dict[str, object]:
    clean_id = _safe_identifier(configuration_id, "configuration")
    if not RECEPTOR_ROOT.is_dir():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Docking configuration not found.")
    for path in RECEPTOR_ROOT.glob(f"*/configurations/{clean_id}.json"):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if payload.get("configuration_id") == clean_id and payload.get("approved") is True:
            return payload
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Docking configuration not found.")


def prepared_receptor_path(receptor_id: str) -> Path:
    metadata = read_receptor(receptor_id)
    relative = metadata.get("prepared_pdbqt")
    if not relative:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A prepared receptor PDBQT is required before docking.",
        )
    resource_dir = _resource_dir(receptor_id)
    path = (resource_dir / str(relative)).resolve()
    if resource_dir not in path.parents or not path.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Prepared receptor PDBQT is missing.")
    return path


def _resource_dir(receptor_id: str) -> Path:
    return (RECEPTOR_ROOT / _safe_identifier(receptor_id, "receptor")).resolve()


def _safe_identifier(value: str, label: str) -> str:
    clean = str(value or "").strip()
    if not re.fullmatch(r"[a-f0-9]{32}", clean):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid {label} identifier.")
    return clean


def _sanitize_filename(filename: str, suffix: str) -> str:
    stem = _SAFE_NAME.sub("_", Path(filename).stem).strip("._") or "receptor"
    return f"{stem[:100]}{suffix}"


def _relative_to_resource(resource_dir: Path, path: Path) -> str:
    return path.relative_to(resource_dir).as_posix()


def _write_metadata(resource_dir: Path, payload: dict[str, object]) -> None:
    _write_json(resource_dir / "metadata.json", payload)


def _write_json(path: Path, payload: dict[str, object]) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat()
