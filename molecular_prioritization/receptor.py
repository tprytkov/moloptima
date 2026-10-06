"""Receptor structure inventory plus prepared Vina receptor validation."""

from __future__ import annotations

import hashlib
import math
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping


MAX_RECEPTOR_BYTES = 100 * 1024 * 1024
_PDBQT_ATOM_TYPE = re.compile(r"[A-Za-z][A-Za-z0-9]?")
WATER_RESIDUES = frozenset({"HOH", "WAT", "H2O", "DOD"})
COMMON_SINGLE_ATOM_IONS = frozenset({
    "AL", "BA", "BR", "CA", "CD", "CL", "CO", "CS", "CU", "F", "FE", "HG",
    "I", "K", "LI", "MG", "MN", "NA", "NI", "PB", "RB", "SR", "ZN",
})
STANDARD_PROTEIN_RESIDUES = frozenset({
    "ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE",
    "LEU", "LYS", "MET", "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL",
    "ASX", "GLX", "SEC", "PYL", "MSE",
})
PDB_ELEMENT_SYMBOLS = frozenset({
    "H", "HE", "LI", "BE", "B", "C", "N", "O", "F", "NE", "NA", "MG",
    "AL", "SI", "P", "S", "CL", "AR", "K", "CA", "SC", "TI", "V", "CR",
    "MN", "FE", "CO", "NI", "CU", "ZN", "GA", "GE", "AS", "SE", "BR",
    "KR", "RB", "SR", "Y", "ZR", "NB", "MO", "TC", "RU", "RH", "PD",
    "AG", "CD", "IN", "SN", "SB", "TE", "I", "XE", "CS", "BA", "LA",
    "CE", "PR", "ND", "PM", "SM", "EU", "GD", "TB", "DY", "HO", "ER",
    "TM", "YB", "LU", "HF", "TA", "W", "RE", "OS", "IR", "PT", "AU",
    "HG", "TL", "PB", "BI", "PO", "AT", "RN", "FR", "RA", "AC", "TH",
    "PA", "U", "NP", "PU", "AM", "CM", "BK", "CF", "ES", "FM", "MD",
    "NO", "LR", "RF", "DB", "SG", "BH", "HS", "MT", "DS", "RG", "CN",
    "NH", "FL", "MC", "LV", "TS", "OG", "D",
})


class ReceptorValidationError(ValueError):
    """A prepared receptor or explicit docking configuration is invalid."""


@dataclass(frozen=True)
class ReceptorArtifact:
    path: Path
    receptor_id: str
    source: str
    source_filename: str
    prepared_receptor_sha256: str
    size_bytes: int


@dataclass(frozen=True)
class VinaBoxConfig:
    center_x: float
    center_y: float
    center_z: float
    size_x: float
    size_y: float
    size_z: float
    exhaustiveness: int
    num_modes: int
    seed: int
    worker_count: int = 4
    energy_range: float | None = None

    @classmethod
    def from_mapping(cls, values: Mapping[str, object]) -> "VinaBoxConfig":
        try:
            raw_energy_range = values.get("energy_range")
            config = cls(
                center_x=float(values["center_x"]),
                center_y=float(values["center_y"]),
                center_z=float(values["center_z"]),
                size_x=float(values["size_x"]),
                size_y=float(values["size_y"]),
                size_z=float(values["size_z"]),
                exhaustiveness=int(values["exhaustiveness"]),
                num_modes=int(values["num_modes"]),
                seed=int(values["seed"]),
                worker_count=int(values.get("worker_count", 4)),
                energy_range=(
                    None
                    if raw_energy_range is None or raw_energy_range == ""
                    else float(raw_energy_range)
                ),
            )
        except (KeyError, TypeError, ValueError) as exc:
            raise ReceptorValidationError(
                "Docking requires explicit numeric center, size, exhaustiveness, num_modes, and seed values."
            ) from exc
        if not all(math.isfinite(value) for value in (
            config.center_x, config.center_y, config.center_z,
            config.size_x, config.size_y, config.size_z,
        )):
            raise ReceptorValidationError("Docking box coordinates and sizes must be finite.")
        if min(config.size_x, config.size_y, config.size_z) <= 0:
            raise ReceptorValidationError("Docking box sizes must be greater than zero.")
        if config.exhaustiveness <= 0 or config.num_modes <= 0 or config.worker_count <= 0:
            raise ReceptorValidationError(
                "exhaustiveness, num_modes, and worker_count must be positive integers."
            )
        if config.energy_range is not None and (
            not math.isfinite(config.energy_range) or config.energy_range <= 0
        ):
            raise ReceptorValidationError("energy_range must be a finite positive number when supplied.")
        return config

    def as_dict(self) -> dict[str, object]:
        values = {
            "center_x": self.center_x, "center_y": self.center_y, "center_z": self.center_z,
            "size_x": self.size_x, "size_y": self.size_y, "size_z": self.size_z,
            "exhaustiveness": self.exhaustiveness, "num_modes": self.num_modes,
            "seed": self.seed, "worker_count": self.worker_count, "cpu": 1,
        }
        if self.energy_range is not None:
            values["energy_range"] = self.energy_range
        return values

    @property
    def effective_worker_count(self) -> int:
        return max(1, min(self.worker_count, os.cpu_count() or 1))


@dataclass(frozen=True)
class ReceptorAtom:
    record: str
    serial: int
    atom_name: str
    residue_name: str
    chain: str
    residue_number: str
    insertion_code: str
    x: float
    y: float
    z: float
    element: str
    altloc: str
    occupancy: float | None
    source_line: str


@dataclass(frozen=True)
class BoundLigand:
    ligand_id: str
    residue_name: str
    chain: str
    residue_number: str
    insertion_code: str
    atom_count: int
    center_x: float
    center_y: float
    center_z: float
    min_x: float
    min_y: float
    min_z: float
    max_x: float
    max_y: float
    max_z: float

    def as_dict(self) -> dict[str, object]:
        return {
            "ligand_id": self.ligand_id,
            "residue_name": self.residue_name,
            "chain": self.chain,
            "residue_number": self.residue_number,
            "insertion_code": self.insertion_code,
            "atom_count": self.atom_count,
            "centroid": {
                "center_x": self.center_x,
                "center_y": self.center_y,
                "center_z": self.center_z,
            },
            "heavy_atom_bounds": {
                "min_x": self.min_x, "min_y": self.min_y, "min_z": self.min_z,
                "max_x": self.max_x, "max_y": self.max_y, "max_z": self.max_z,
            },
            "default_box": {
                "center_x": (self.min_x + self.max_x) / 2,
                "center_y": (self.min_y + self.max_y) / 2,
                "center_z": (self.min_z + self.max_z) / 2,
                "size_x": self.max_x - self.min_x + 8.0,
                "size_y": self.max_y - self.min_y + 8.0,
                "size_z": self.max_z - self.min_z + 8.0,
                "padding": 4.0,
            },
        }


def validate_receptor_pdb(path: str | Path) -> dict[str, object]:
    """Validate a visualization PDB without treating it as a prepared Vina receptor."""

    receptor_path = Path(path).resolve()
    if receptor_path.suffix.lower() != ".pdb":
        raise ReceptorValidationError("Visualization receptor input must be a .pdb file.")
    if not receptor_path.is_file():
        raise ReceptorValidationError("Receptor PDB file is missing.")
    size = receptor_path.stat().st_size
    if size <= 0 or size > MAX_RECEPTOR_BYTES:
        raise ReceptorValidationError("Receptor PDB is empty or exceeds 100 MB.")
    try:
        receptor_bytes = receptor_path.read_bytes()
        text = receptor_bytes.decode("utf-8", errors="strict")
    except (OSError, UnicodeError) as exc:
        raise ReceptorValidationError("Receptor PDB is not readable text.") from exc
    atoms = parse_receptor_atoms(text)
    if not atoms:
        raise ReceptorValidationError("Receptor PDB contains no valid ATOM/HETATM records.")
    return {
        "path": receptor_path,
        "sha256": hashlib.sha256(receptor_bytes).hexdigest(),
        "size_bytes": size,
        "atom_count": len(atoms),
        "bound_ligands": [ligand.as_dict() for ligand in identify_bound_ligands(atoms)],
        "structure_inventory": receptor_structure_inventory(atoms),
    }


def parse_receptor_atoms(text: str) -> list[ReceptorAtom]:
    """Parse only fixed-column atom identity and coordinates needed by setup tools."""

    atoms: list[ReceptorAtom] = []
    for line_number, line in enumerate(text.splitlines(), start=1):
        if not line.startswith(("ATOM  ", "HETATM")):
            continue
        prefix = f"Receptor atom record on line {line_number}"
        if len(line) < 54:
            raise ReceptorValidationError(f"{prefix} is too short for fixed-column coordinates.")
        try:
            serial = int(line[6:11].strip())
            coordinates = tuple(float(line[start:end].strip()) for start, end in (
                (30, 38), (38, 46), (46, 54),
            ))
        except ValueError as exc:
            raise ReceptorValidationError(f"{prefix} has malformed serial or coordinates.") from exc
        if not all(math.isfinite(value) for value in coordinates):
            raise ReceptorValidationError(f"{prefix} has non-finite coordinates.")
        residue_name = line[17:20].strip().upper()
        atom_name = line[12:16].strip()
        if not atom_name or not residue_name:
            raise ReceptorValidationError(f"{prefix} is missing atom or residue identity.")
        element = (line[76:78].strip() if len(line) >= 78 else "").upper()
        if not element:
            element = infer_pdb_element(line[12:16]) or ""
        occupancy = None
        if len(line) >= 60 and line[54:60].strip():
            try:
                occupancy = float(line[54:60].strip())
            except ValueError as exc:
                raise ReceptorValidationError(f"{prefix} has malformed occupancy.") from exc
            if not math.isfinite(occupancy):
                raise ReceptorValidationError(f"{prefix} has non-finite occupancy.")
        atoms.append(ReceptorAtom(
            record=line[:6].strip(), serial=serial, atom_name=atom_name,
            residue_name=residue_name, chain=line[21:22].strip(),
            residue_number=line[22:26].strip(), insertion_code=line[26:27].strip(),
            x=coordinates[0], y=coordinates[1], z=coordinates[2], element=element,
            altloc=line[16:17].strip(), occupancy=occupancy, source_line=line,
        ))
    return atoms


def infer_pdb_element(atom_name_field: str) -> str | None:
    """Infer an element only when standard PDB atom-name alignment is decisive."""

    field = atom_name_field[:4].ljust(4)
    stripped = field.strip()
    if not stripped:
        return None
    if field[0].isspace() or field[0].isdigit():
        match = re.search(r"[A-Za-z]", field)
        candidate = match.group(0).upper() if match else ""
    elif len(stripped) == 4 and stripped[0].upper() in {"H", "D"}:
        # Four-character protein hydrogen names such as HH11 and HE21 use
        # the first character as the element, despite HE/HG being elements.
        candidate = stripped[0].upper()
    else:
        letters = re.sub(r"[^A-Za-z]", "", stripped).upper()
        two_letter = letters[:2]
        candidate = two_letter if two_letter in PDB_ELEMENT_SYMBOLS else letters[:1]
    return candidate if candidate in PDB_ELEMENT_SYMBOLS else None


def residue_key(atom: ReceptorAtom) -> str:
    """Return the portable chain/residue key used by preparation choices."""

    return f"{atom.chain}:{atom.residue_number}{atom.insertion_code}"


def hetero_group_id(atom: ReceptorAtom) -> str:
    """Return a stable identifier for one HETATM residue group."""

    return ":".join((atom.residue_name, atom.chain or "_", atom.residue_number or "_", atom.insertion_code or "_"))


def receptor_structure_inventory(atoms: Iterable[ReceptorAtom]) -> dict[str, object]:
    """Summarize actual PDB chains, waters, hetero groups, and altloc ambiguity."""

    atom_list = list(atoms)
    protein_residues: dict[str, set[tuple[str, str]]] = {}
    water_groups: dict[str, list[ReceptorAtom]] = {}
    hetero_groups: dict[str, list[ReceptorAtom]] = {}
    residue_altlocs: dict[str, set[str]] = {}
    for atom in atom_list:
        if atom.record == "ATOM":
            protein_residues.setdefault(atom.chain, set()).add((atom.residue_number, atom.insertion_code))
            if atom.altloc:
                residue_altlocs.setdefault(residue_key(atom), set()).add(atom.altloc)
        elif atom.residue_name in WATER_RESIDUES:
            water_groups.setdefault(hetero_group_id(atom), []).append(atom)
        else:
            hetero_groups.setdefault(hetero_group_id(atom), []).append(atom)
            if atom.altloc:
                residue_altlocs.setdefault(residue_key(atom), set()).add(atom.altloc)

    ligand_ids = {item.ligand_id for item in identify_bound_ligands(atom_list)}
    hetero_inventory = []
    for group_id, group in sorted(hetero_groups.items()):
        first = group[0]
        obvious_ion = len(group) == 1 and (
            first.residue_name in COMMON_SINGLE_ATOM_IONS or first.element in COMMON_SINGLE_ATOM_IONS
        )
        category = "ion" if obvious_ion else ("ligand_candidate" if group_id in ligand_ids else "hetero")
        hetero_inventory.append({
            "group_id": group_id,
            "type": category,
            "residue_name": first.residue_name,
            "chain": first.chain,
            "residue_number": first.residue_number,
            "insertion_code": first.insertion_code,
            "atom_count": len(group),
            "centroid": {
                "center_x": sum(atom.x for atom in group) / len(group),
                "center_y": sum(atom.y for atom in group) / len(group),
                "center_z": sum(atom.z for atom in group) / len(group),
            },
        })

    return {
        "protein": {
            "chains": [
                {"chain": chain, "residue_count": len(residues), "atom_count": sum(
                    1 for atom in atom_list if atom.record == "ATOM" and atom.chain == chain
                )}
                for chain, residues in sorted(protein_residues.items())
            ],
            "residue_count": sum(len(items) for items in protein_residues.values()),
            "atom_count": sum(1 for atom in atom_list if atom.record == "ATOM"),
        },
        "waters": {
            "count": len(water_groups),
            "residues": [
                {
                    "group_id": group_id,
                    "residue_name": group[0].residue_name,
                    "chain": group[0].chain,
                    "residue_number": group[0].residue_number,
                    "insertion_code": group[0].insertion_code,
                    "atom_count": len(group),
                }
                for group_id, group in sorted(water_groups.items())
            ],
        },
        "hetero_groups": hetero_inventory,
        "alternate_locations": [
            {"residue_key": key, "choices": sorted(choices)}
            for key, choices in sorted(residue_altlocs.items())
            if choices
        ],
        "explicit_hydrogen_atom_count": sum(1 for atom in atom_list if atom.element in {"H", "D"}),
    }


def identify_bound_ligands(atoms: Iterable[ReceptorAtom]) -> list[BoundLigand]:
    """Return plausible multi-atom HETATM residues, excluding waters and obvious ions."""

    groups: dict[tuple[str, str, str, str], list[ReceptorAtom]] = {}
    for atom in atoms:
        if atom.record != "HETATM" or atom.residue_name in WATER_RESIDUES:
            continue
        key = (atom.residue_name, atom.chain, atom.residue_number, atom.insertion_code)
        groups.setdefault(key, []).append(atom)
    ligands: list[BoundLigand] = []
    for key, group in sorted(groups.items()):
        residue_name, chain, residue_number, insertion_code = key
        if len(group) == 1 and (
            residue_name in COMMON_SINGLE_ATOM_IONS or group[0].element in COMMON_SINGLE_ATOM_IONS
        ):
            continue
        ligand_id = ":".join((residue_name, chain or "_", residue_number or "_", insertion_code or "_"))
        heavy = [atom for atom in group if atom.element not in {"H", "D"}]
        if not heavy:
            continue
        atom_count = len(group)
        ligands.append(BoundLigand(
            ligand_id=ligand_id, residue_name=residue_name, chain=chain,
            residue_number=residue_number, insertion_code=insertion_code,
            atom_count=atom_count,
            center_x=sum(atom.x for atom in group) / atom_count,
            center_y=sum(atom.y for atom in group) / atom_count,
            center_z=sum(atom.z for atom in group) / atom_count,
            min_x=min(atom.x for atom in heavy), min_y=min(atom.y for atom in heavy), min_z=min(atom.z for atom in heavy),
            max_x=max(atom.x for atom in heavy), max_y=max(atom.y for atom in heavy), max_z=max(atom.z for atom in heavy),
        ))
    return ligands


def validate_prepared_receptor(
    path: str | Path,
    *,
    receptor_id: str = "",
    source: str = "uploaded_prepared_pdbqt",
    source_filename: str = "",
) -> ReceptorArtifact:
    receptor_path = Path(path).resolve()
    if receptor_path.suffix.lower() != ".pdbqt":
        raise ReceptorValidationError("Receptor input must be an already prepared .pdbqt file.")
    if not receptor_path.is_file():
        raise ReceptorValidationError("Prepared receptor file is missing.")
    size = receptor_path.stat().st_size
    if size <= 0 or size > MAX_RECEPTOR_BYTES:
        raise ReceptorValidationError("Prepared receptor file is empty or exceeds 100 MB.")
    try:
        receptor_bytes = receptor_path.read_bytes()
        text = receptor_bytes.decode("utf-8", errors="strict")
    except (OSError, UnicodeError) as exc:
        raise ReceptorValidationError("Prepared receptor PDBQT is not readable text.") from exc
    atom_records = [
        (line_number, line)
        for line_number, line in enumerate(text.splitlines(), start=1)
        if line.startswith(("ATOM  ", "HETATM"))
    ]
    if not atom_records:
        raise ReceptorValidationError("Prepared receptor PDBQT contains no ATOM/HETATM records.")
    for line_number, line in atom_records:
        _validate_pdbqt_atom_record(line, line_number=line_number)
    _audit_pdbqt_hydrogen_records(atom_records)
    digest = hashlib.sha256(receptor_bytes).hexdigest()
    return ReceptorArtifact(
        path=receptor_path,
        receptor_id=receptor_id.strip() or receptor_path.stem,
        source=source,
        source_filename=source_filename.strip() or receptor_path.name,
        prepared_receptor_sha256=digest,
        size_bytes=size,
    )


def audit_prepared_receptor_hydrogens(path: str | Path) -> dict[str, object]:
    """Audit the final AutoDock polar-hydrogen representation in a receptor PDBQT."""

    receptor_path = Path(path).resolve()
    try:
        text = receptor_path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeError) as exc:
        raise ReceptorValidationError("Prepared receptor PDBQT is not readable text.") from exc
    atom_records = [
        (line_number, line)
        for line_number, line in enumerate(text.splitlines(), start=1)
        if line.startswith(("ATOM  ", "HETATM"))
    ]
    if not atom_records:
        raise ReceptorValidationError("Prepared receptor PDBQT contains no ATOM/HETATM records.")
    for line_number, line in atom_records:
        _validate_pdbqt_atom_record(line, line_number=line_number)
    return _audit_pdbqt_hydrogen_records(atom_records)


def _audit_pdbqt_hydrogen_records(
    atom_records: list[tuple[int, str]],
) -> dict[str, object]:
    atoms = []
    for line_number, line in atom_records:
        atom_type = line[77:79].strip().upper()
        atoms.append({
            "line_number": line_number,
            "serial": int(line[6:11].strip()),
            "atom_name": line[12:16].strip(),
            "residue_name": line[17:20].strip(),
            "chain": line[21:22].strip(),
            "residue_number": line[22:26].strip(),
            "coordinates": tuple(float(line[start:end].strip()) for start, end in (
                (30, 38), (38, 46), (46, 54),
            )),
            "atom_type": atom_type,
            "element": _autodock_element(atom_type),
        })

    heavy_atoms = [atom for atom in atoms if atom["element"] != "H"]
    hydrogens = [atom for atom in atoms if atom["element"] == "H"]
    details = []
    for hydrogen in hydrogens:
        candidates = sorted(
            (
                (math.dist(hydrogen["coordinates"], atom["coordinates"]), atom)
                for atom in heavy_atoms
            ),
            key=lambda item: (item[0], item[1]["serial"]),
        )
        if not candidates or not 0.4 <= candidates[0][0] <= 1.45:
            raise ReceptorValidationError(
                f"Prepared receptor PDBQT explicit hydrogen atom {hydrogen['serial']} has no plausible covalent parent."
            )
        distance, parent = candidates[0]
        if parent["element"] == "C":
            raise ReceptorValidationError(
                f"Prepared receptor PDBQT retains carbon-bound hydrogen atom {hydrogen['serial']} explicitly; "
                "AutoDock receptor PDBQT must use the united-atom representation for nonpolar hydrogens."
            )
        if hydrogen["atom_type"] != "HD":
            raise ReceptorValidationError(
                "Prepared receptor PDBQT contains an explicit hydrogen that is not the "
                f"AutoDock donor-hydrogen type HD (atom {hydrogen['serial']}, type {hydrogen['atom_type']})."
            )
        if parent["element"] not in {"N", "O", "S"}:
            raise ReceptorValidationError(
                f"Prepared receptor PDBQT explicit hydrogen atom {hydrogen['serial']} is attached to unsupported "
                f"parent element {parent['element'] or 'unknown'}."
            )
        details.append({
            "serial": hydrogen["serial"],
            "atom_name": hydrogen["atom_name"],
            "residue_name": hydrogen["residue_name"],
            "chain": hydrogen["chain"],
            "residue_number": hydrogen["residue_number"],
            "autodock_atom_type": hydrogen["atom_type"],
            "parent_serial": parent["serial"],
            "parent_atom_name": parent["atom_name"],
            "parent_element": parent["element"],
            "parent_autodock_atom_type": parent["atom_type"],
            "parent_distance_angstrom": round(distance, 6),
        })
    return {
        "representation": "autodock_polar_hydrogen_united_atom",
        "total_atom_record_count": len(atoms),
        "explicit_hydrogen_atom_count": len(hydrogens),
        "explicit_hydrogen_autodock_types": [item["autodock_atom_type"] for item in details],
        "explicit_hydrogen_parent_elements": [item["parent_element"] for item in details],
        "carbon_bound_explicit_hydrogen_count": 0,
        "polar_donor_hydrogen_count": len(details),
        "explicit_hydrogens": details,
        "validation_status": "valid",
    }


def _autodock_element(atom_type: str) -> str:
    normalized = atom_type.strip().upper()
    if normalized in {"H", "HD", "HS"}:
        return "H"
    if normalized in {"C", "A"}:
        return "C"
    if normalized.startswith("N"):
        return "N"
    if normalized.startswith("O"):
        return "O"
    if normalized.startswith("S"):
        return "S"
    if normalized.startswith("P"):
        return "P"
    return normalized


def _validate_pdbqt_atom_record(line: str, *, line_number: int) -> None:
    """Reject atom records that clearly lack the fixed-column PDBQT fields Vina needs."""
    prefix = f"Prepared receptor PDBQT atom record on line {line_number}"
    if len(line) < 78:
        raise ReceptorValidationError(
            f"{prefix} is too short to contain PDBQT coordinates, partial charge, and atom type."
        )
    try:
        int(line[6:11].strip())
    except ValueError as exc:
        raise ReceptorValidationError(f"{prefix} has an invalid atom serial number.") from exc
    if not line[12:16].strip():
        raise ReceptorValidationError(f"{prefix} has no atom name.")

    coordinate_fields = (line[30:38], line[38:46], line[46:54])
    try:
        coordinates = tuple(float(value.strip()) for value in coordinate_fields)
    except ValueError as exc:
        raise ReceptorValidationError(f"{prefix} has malformed fixed-column coordinates.") from exc
    if not all(math.isfinite(value) for value in coordinates):
        raise ReceptorValidationError(f"{prefix} has non-finite coordinates.")

    try:
        partial_charge = float(line[70:76].strip())
    except ValueError as exc:
        raise ReceptorValidationError(
            f"{prefix} is missing a valid PDBQT partial charge in columns 71-76."
        ) from exc
    if not math.isfinite(partial_charge):
        raise ReceptorValidationError(f"{prefix} has a non-finite PDBQT partial charge.")

    atom_type = line[77:79].strip()
    if not _PDBQT_ATOM_TYPE.fullmatch(atom_type):
        raise ReceptorValidationError(
            f"{prefix} is missing a valid AutoDock atom type in columns 78-79."
        )
