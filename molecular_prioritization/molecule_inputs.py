"""Canonical, provenance-preserving molecule import for MolOptima."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Mapping, Sequence

from rdkit import Chem

from molecular_prioritization.standardize import standardize_smiles


SMILES_COLUMN_ALIASES = {"smiles", "canonical_smiles"}
ID_COLUMN_ALIASES = {"molecule_id", "id", "name"}
PDB_PREFERENCE_WARNING = (
    "SDF is preferred for small-molecule structure files because it preserves "
    "bond orders and formal charges more reliably than PDB."
)
SDF_MULTI_RECORD_ERROR = (
    "MolOptima accepts one molecule per SDF file. For a molecular library, place "
    "individual SDF files in a folder or select multiple SDF files."
)
DOCKING_COORDINATE_WARNING = (
    "Original structure coordinates are preserved as provenance; the qualified production "
    "ligand-preparation path currently regenerates docking coordinates from canonical SMILES."
)
PRIVATE_PATH_RE = re.compile(r"(?:[A-Za-z]:\\|/(?:Users|home)/)")


@dataclass
class SourceInput:
    filename: str
    content: bytes


@dataclass
class ImportRecord:
    requested_id: str = ""
    supported_name: str = ""
    source_type: str = "smiles"
    source_filename: str = ""
    source_record: str = ""
    input_smiles: str = ""
    canonical_smiles: str = ""
    structure_status: str = "invalid_structure"
    coordinate_status: str = "none"
    input_has_3d: bool = False
    original_structure_sha256: str = ""
    validation_status: str = "invalid"
    failure_reason: str = ""
    warnings: list[str] = field(default_factory=list)
    sd_properties: dict[str, str] = field(default_factory=dict)
    molecule_id: str = ""
    original_molecule_id: str = ""
    duplicate_structure: bool = False

    @property
    def valid(self) -> bool:
        return self.validation_status == "valid" and bool(self.canonical_smiles)

    def public_dict(self) -> dict[str, object]:
        return {
            "molecule_id": self.molecule_id,
            "original_molecule_id": self.original_molecule_id,
            "source_type": self.source_type,
            "source_filename": Path(self.source_filename).name if self.source_filename else "",
            "source_record": self.source_record,
            "input_smiles": self.input_smiles,
            "canonical_smiles": self.canonical_smiles,
            "structure_status": self.structure_status,
            "coordinate_status": self.coordinate_status,
            "input_has_3d": self.input_has_3d,
            "original_structure_sha256": self.original_structure_sha256,
            "validation_status": self.validation_status,
            "failure_reason": self.failure_reason,
            "warnings": list(self.warnings),
            "sd_properties": dict(self.sd_properties),
            "duplicate_structure": self.duplicate_structure,
        }


def import_molecule_collection(
    *,
    smiles_text: str = "",
    files: Sequence[SourceInput] = (),
    selected_structure_column: str = "",
) -> dict[str, object]:
    """Parse heterogeneous inputs into one deterministic canonical collection."""

    records: list[ImportRecord] = []
    ignored_files: list[str] = []
    if smiles_text.strip():
        records.extend(_parse_smiles_lines(smiles_text))

    for source in files:
        filename = Path(source.filename).name
        suffix = Path(filename).suffix.lower()
        if suffix in {".csv", ".tsv"}:
            records.extend(_parse_delimited(source, selected_structure_column))
        elif suffix == ".sdf":
            records.append(_parse_sdf(source))
        elif suffix == ".pdb":
            records.append(_parse_pdb(source))
        else:
            ignored_files.append(filename)

    _assign_deterministic_ids(records)
    duplicate_count = _mark_duplicate_structures(records)
    valid_count = sum(record.valid for record in records)
    unresolved_pdb_count = sum(record.structure_status == "unresolved_pdb_chemistry" for record in records)
    analysis_mode = (
        "single_compound" if valid_count == 1 else "library" if valid_count >= 2 else "unavailable"
    )
    return {
        "records": [record.public_dict() for record in records],
        "summary": {
            "submitted_count": len(records),
            "valid_count": valid_count,
            "invalid_count": len(records) - valid_count,
            "unresolved_pdb_count": unresolved_pdb_count,
            "duplicate_count": duplicate_count,
            "files_found": len(files),
            "invalid_file_count": sum(
                not record.valid and record.source_type in {"sdf", "pdb"} for record in records
            ),
            "multi_record_sdf_count": sum(
                record.failure_reason == SDF_MULTI_RECORD_ERROR for record in records
            ),
            "ignored_file_count": len(ignored_files),
            "ignored_files": ignored_files,
            "analysis_mode": analysis_mode,
            "analysis_mode_label": _analysis_mode_label(analysis_mode),
        },
    }


def write_canonical_collection(collection: Mapping[str, object], csv_path: Path, manifest_path: Path) -> None:
    records = list(collection.get("records") or [])
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fields = [
        "molecule_id", "smiles", "source_type", "source_filename", "source_record",
        "input_smiles", "canonical_smiles", "structure_status", "coordinate_status",
        "input_has_3d", "original_structure_sha256", "validation_status", "failure_reason",
        "warnings", "original_molecule_id", "duplicate_structure",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for record in records:
            public = dict(record)
            writer.writerow({
                **{key: public.get(key, "") for key in fields},
                "smiles": public.get("canonical_smiles") or public.get("input_smiles") or "",
                "warnings": json.dumps(public.get("warnings") or [], sort_keys=True),
            })
    with manifest_path.open("w", encoding="utf-8") as handle:
        json.dump(collection, handle, indent=2, sort_keys=True)
        handle.write("\n")


def _parse_smiles_lines(text: str) -> list[ImportRecord]:
    records = []
    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        parts = line.split()
        requested_id = ""
        smiles = ""
        if len(parts) == 1:
            smiles = parts[0]
        elif len(parts) == 2:
            requested_id, smiles = parts
        else:
            records.append(ImportRecord(
                source_record=f"line:{line_number}", input_smiles=line,
                failure_reason="SMILES list lines must contain SMILES only or molecule_id followed by SMILES.",
            ))
            continue
        records.append(_record_from_smiles(
            smiles, requested_id=requested_id, source_type="smiles",
            source_record=f"line:{line_number}",
        ))
    return records


def _parse_delimited(source: SourceInput, selected_structure_column: str) -> list[ImportRecord]:
    filename = Path(source.filename).name
    source_type = "csv"
    try:
        text = source.content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [_file_failure(source_type, filename, source.content, "CSV/TSV must be UTF-8 encoded.")]
    delimiter = "\t" if Path(filename).suffix.lower() == ".tsv" else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    columns = list(reader.fieldnames or [])
    normalized = {column.strip().lower(): column for column in columns if column}
    plausible = [
        column for column in columns
        if column and column.strip().lower() in SMILES_COLUMN_ALIASES
    ]
    selected = ""
    if selected_structure_column:
        requested = selected_structure_column.strip()
        matches = [column for column in columns if column == requested]
        if not matches:
            matches = [column for column in columns if column.strip().lower() == requested.lower()]
        if len(matches) != 1:
            return [_file_failure(source_type, filename, source.content, "Selected structure column did not uniquely identify one column.")]
        selected = matches[0]
    elif len(plausible) == 1:
        selected = plausible[0]
    elif len(plausible) > 1:
        return [_file_failure(
            source_type, filename, source.content,
            "Multiple plausible structure columns were found; select the SMILES structure column explicitly.",
        )]
    else:
        return [_file_failure(source_type, filename, source.content, "CSV/TSV has no supported SMILES column.")]
    id_columns = [
        column for column in columns
        if column and column.strip().lower() in ID_COLUMN_ALIASES
    ]
    id_column = id_columns[0] if id_columns else ""
    records = []
    for row_number, row in enumerate(reader, start=2):
        records.append(_record_from_smiles(
            str(row.get(selected) or ""), requested_id=str(row.get(id_column) or "") if id_column else "",
            source_type=source_type, source_filename=filename, source_record=f"row:{row_number}",
            source_bytes=source.content,
        ))
    return records


def _parse_sdf(source: SourceInput) -> ImportRecord:
    filename = Path(source.filename).name
    digest = hashlib.sha256(source.content).hexdigest()
    try:
        text = source.content.decode("utf-8")
    except UnicodeDecodeError:
        return _file_failure("sdf", filename, source.content, "SDF must be UTF-8 compatible.")
    blocks = [block for block in text.split("$$$$") if block.strip()]
    if len(blocks) != 1 or text.count("$$$$") > 1:
        return _file_failure("sdf", filename, source.content, SDF_MULTI_RECORD_ERROR)
    supplier = Chem.ForwardSDMolSupplier(
        io.BytesIO(source.content), sanitize=True, removeHs=False, strictParsing=True,
    )
    parsed = list(supplier)
    molecule = parsed[0] if len(parsed) == 1 else None
    if molecule is None:
        return _file_failure("sdf", filename, source.content, "RDKit could not parse and sanitize this SDF molecule.")
    canonical = Chem.MolToSmiles(Chem.RemoveHs(molecule), canonical=True, isomericSmiles=True)
    title = molecule.GetProp("_Name").strip() if molecule.HasProp("_Name") else ""
    properties = {name: molecule.GetProp(name) for name in molecule.GetPropNames()}
    coordinate_status, has_3d = _coordinate_status(molecule)
    return ImportRecord(
        supported_name=title, source_type="sdf", source_filename=filename, source_record="record:1",
        input_smiles=canonical, canonical_smiles=canonical, structure_status="validated",
        coordinate_status=coordinate_status, input_has_3d=has_3d,
        original_structure_sha256=digest, validation_status="valid",
        warnings=[DOCKING_COORDINATE_WARNING], sd_properties=properties,
    )


def _parse_pdb(source: SourceInput) -> ImportRecord:
    filename = Path(source.filename).name
    digest = hashlib.sha256(source.content).hexdigest()
    try:
        block = source.content.decode("utf-8")
    except UnicodeDecodeError:
        return _file_failure("pdb", filename, source.content, "PDB must be UTF-8 compatible.")
    if not any(line.startswith(("ATOM  ", "HETATM")) for line in block.splitlines()):
        return _file_failure("pdb", filename, source.content, "PDB contains no ATOM/HETATM records.")
    molecule = Chem.MolFromPDBBlock(block, sanitize=False, removeHs=False, proximityBonding=False)
    if molecule is None:
        return _file_failure("pdb", filename, source.content, "RDKit could not parse this ligand PDB.")
    unresolved = _pdb_chemistry_problem(molecule)
    if unresolved:
        record = _file_failure("pdb", filename, source.content, unresolved, "unresolved_pdb_chemistry")
        record.warnings = [PDB_PREFERENCE_WARNING]
        return record
    try:
        Chem.SanitizeMol(molecule)
        canonical = Chem.MolToSmiles(Chem.RemoveHs(molecule), canonical=True, isomericSmiles=True)
    except Exception as exc:
        record = _file_failure(
            "pdb", filename, source.content, f"PDB chemistry could not be sanitized safely: {exc}",
            "unresolved_pdb_chemistry",
        )
        record.warnings = [PDB_PREFERENCE_WARNING]
        return record
    coordinate_status, has_3d = _coordinate_status(molecule)
    title = next((line[10:].strip() for line in block.splitlines() if line.startswith("COMPND")), "")
    return ImportRecord(
        supported_name=title, source_type="pdb", source_filename=filename, source_record="model:1",
        input_smiles=canonical, canonical_smiles=canonical, structure_status="validated",
        coordinate_status=coordinate_status, input_has_3d=has_3d,
        original_structure_sha256=digest, validation_status="valid",
        warnings=[PDB_PREFERENCE_WARNING, DOCKING_COORDINATE_WARNING],
    )


def _pdb_chemistry_problem(molecule: Chem.Mol) -> str:
    if molecule.GetNumAtoms() < 2:
        return "PDB does not contain a resolvable multi-atom ligand graph."
    if molecule.GetNumBonds() == 0:
        return "PDB lacks explicit CONECT connectivity required for fail-closed ligand chemistry resolution."
    expected_valence = {"H": 1, "C": 4, "N": 3, "O": 2, "F": 1, "CL": 1, "BR": 1, "I": 1, "P": 3, "S": 2}
    for bond in molecule.GetBonds():
        if bond.GetBondType() != Chem.BondType.SINGLE:
            return "PDB contains unsupported or ambiguous bond-order information."
    for atom in molecule.GetAtoms():
        symbol = atom.GetSymbol().upper()
        target = expected_valence.get(symbol)
        if target is None:
            return f"PDB element {atom.GetSymbol()} is outside the conservative ligand chemistry contract."
        if atom.GetFormalCharge() != 0 or atom.GetDegree() != target:
            return (
                "PDB bond orders/formal charges are ambiguous; explicit CONECT connectivity and "
                "chemically complete neutral valence, including hydrogens, are required."
            )
    return ""


def _record_from_smiles(
    smiles: str, *, requested_id: str = "", source_type: str, source_filename: str = "",
    source_record: str = "", source_bytes: bytes | None = None,
) -> ImportRecord:
    input_smiles = smiles.strip()
    standardized = standardize_smiles(input_smiles)
    digest = hashlib.sha256(source_bytes).hexdigest() if source_bytes is not None else ""
    return ImportRecord(
        requested_id=requested_id.strip(), source_type=source_type,
        source_filename=Path(source_filename).name if source_filename else "",
        source_record=source_record, input_smiles=input_smiles,
        canonical_smiles=standardized.canonical_smiles or "",
        structure_status="validated" if standardized.valid_molecule else "invalid_smiles",
        original_structure_sha256=digest, validation_status="valid" if standardized.valid_molecule else "invalid",
        failure_reason=standardized.error or "",
    )


def _file_failure(
    source_type: str, filename: str, content: bytes, reason: str,
    structure_status: str = "invalid_structure",
) -> ImportRecord:
    return ImportRecord(
        source_type=source_type, source_filename=Path(filename).name,
        source_record="file", original_structure_sha256=hashlib.sha256(content).hexdigest(),
        structure_status=structure_status, failure_reason=reason,
    )


def _coordinate_status(molecule: Chem.Mol) -> tuple[str, bool]:
    if molecule.GetNumConformers() == 0:
        return "none", False
    conformer = molecule.GetConformer()
    return ("3d", True) if conformer.Is3D() else ("2d", False)


def _assign_deterministic_ids(records: list[ImportRecord]) -> None:
    counts: dict[str, int] = {}
    for index, record in enumerate(records, start=1):
        base = record.requested_id or record.supported_name or Path(record.source_filename).stem or f"compound_{index:03d}"
        base = re.sub(r"[^A-Za-z0-9_.-]+", "_", base.strip()).strip("_") or f"compound_{index:03d}"
        record.original_molecule_id = base
        counts[base] = counts.get(base, 0) + 1
        record.molecule_id = base if counts[base] == 1 else f"{base}__{counts[base]}"


def _mark_duplicate_structures(records: Iterable[ImportRecord]) -> int:
    seen: set[str] = set()
    duplicates = 0
    for record in records:
        if not record.valid:
            continue
        if record.canonical_smiles in seen:
            record.duplicate_structure = True
            duplicates += 1
        else:
            seen.add(record.canonical_smiles)
    return duplicates


def _analysis_mode_label(mode: str) -> str:
    return {
        "single_compound": "Single Compound Analysis",
        "library": "Library Prioritization",
        "unavailable": "Not available",
    }[mode]
