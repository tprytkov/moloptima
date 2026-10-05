"""Pure import and normalization utilities for experimental assay measurements."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Mapping, Sequence

from rdkit import Chem

from molecular_prioritization.standardize import standardize_smiles


SCHEMA_VERSION = "moloptima-experimental-measurement-v1"
NORMALIZATION_VERSION = "moloptima-concentration-normalization-v1"
CONCENTRATION_ENDPOINTS = {
    "IC50": "pIC50",
    "EC50": "pEC50",
    "KI": "pKi",
    "KD": "pKd",
}
PERCENTAGE_ENDPOINTS = {
    "PERCENT_INHIBITION": "Percent inhibition",
    "PERCENT_ACTIVATION": "Percent activation",
}
CONCENTRATION_UNITS = {
    "M": ("M", 1.0),
    "MM": ("mM", 1e-3),
    "UM": ("uM", 1e-6),
    "NM": ("nM", 1e-9),
    "PM": ("pM", 1e-12),
}
SUPPORTED_RELATIONS = {"=", "<", ">", "<=", ">="}
REVERSED_RELATIONS = {"=": "=", "<": ">", ">": "<", "<=": ">=", ">=": "<="}
UNCERTAINTY_TYPES = {"SD", "SEM", "CI", "MAD", "IQR", "UNKNOWN"}

COLUMN_ALIASES = {
    "molecule_id": ("molecule_id", "mol_id", "compound_id"),
    "smiles": ("smiles", "canonical_smiles", "isomeric_smiles"),
    "endpoint": ("endpoint", "endpoint_name", "measurement_type", "activity_type"),
    "value": ("value", "original_value", "activity_value"),
    "unit": ("unit", "original_unit", "activity_unit"),
    "relation": ("relation", "operator", "standard_relation"),
    "target_identifier": ("target_identifier", "target_id", "target_chembl_id", "uniprot_id"),
    "target_name": ("target_name", "target"),
    "organism": ("organism", "species"),
    "construct_or_isoform": ("construct_or_isoform", "construct", "isoform"),
    "assay_id": ("assay_id",),
    "assay_protocol_version": ("assay_protocol_version", "protocol_version"),
    "assay_type": ("assay_type",),
    "assay_system": ("assay_system",),
    "biological_mode": ("biological_mode", "mode"),
    "readout": ("readout", "readout_definition"),
    "source": ("source", "source_name"),
    "source_record_id": ("source_record_id", "source_record", "record_id"),
    "cell_line": ("cell_line",),
    "tissue": ("tissue",),
    "substrate": ("substrate",),
    "test_concentration": ("test_concentration",),
    "test_concentration_unit": ("test_concentration_unit",),
    "exposure_time": ("exposure_time",),
    "temperature": ("temperature",),
    "ph": ("ph", "p_h"),
    "electrophysiology_protocol": ("electrophysiology_protocol",),
    "electrophysiology_readout": ("electrophysiology_readout",),
    "experimental_batch": ("experimental_batch", "batch"),
    "measurement_date": ("measurement_date", "date"),
    "operator": ("operator",),
    "citation": ("citation", "document_identifier", "doi"),
    "comments": ("comments", "comment", "notes"),
    "replicate_id": ("replicate_id",),
    "replicate_type": ("replicate_type",),
    "replicate_count": ("replicate_count",),
    "uncertainty_type": ("uncertainty_type",),
    "uncertainty_value": ("uncertainty_value",),
    "uncertainty_lower": ("uncertainty_lower",),
    "uncertainty_upper": ("uncertainty_upper",),
    "confidence_level": ("confidence_level",),
    "uncertainty_scale": ("uncertainty_scale",),
}


def canonical_endpoint(value: object) -> str:
    text = str(value or "").strip()
    key = "".join(character for character in text.upper() if character.isalnum())
    aliases = {
        "IC50": "IC50", "EC50": "EC50", "KI": "KI", "KD": "KD",
        "PERCENTINHIBITION": "PERCENT_INHIBITION",
        "INHIBITIONPERCENT": "PERCENT_INHIBITION",
        "PERCENTACTIVATION": "PERCENT_ACTIVATION",
        "ACTIVATIONPERCENT": "PERCENT_ACTIVATION",
    }
    return aliases.get(key, text)


def normalize_concentration(endpoint: object, value: object, unit: object, relation: object) -> dict[str, object]:
    """Normalize one allowlisted concentration and derive its named pEndpoint."""

    endpoint_key = canonical_endpoint(endpoint)
    if endpoint_key not in CONCENTRATION_ENDPOINTS:
        return {"status": "not_applicable", "reason": "unsupported_endpoint"}
    relation_text = str(relation or "").strip()
    if relation_text not in SUPPORTED_RELATIONS:
        return {"status": "invalid", "reason": "unsupported_relation"}
    try:
        numeric = float(str(value).strip())
    except (TypeError, ValueError):
        return {"status": "invalid", "reason": "invalid_numeric_value"}
    if not math.isfinite(numeric) or numeric <= 0:
        return {"status": "invalid", "reason": "concentration_must_be_positive"}
    unit_key = str(unit or "").strip().replace("μ", "u").replace("µ", "u").upper()
    unit_spec = CONCENTRATION_UNITS.get(unit_key)
    if unit_spec is None:
        return {"status": "invalid", "reason": "unsupported_unit_conversion"}
    canonical_unit, factor = unit_spec
    molar = numeric * factor
    transformed = -math.log10(molar)
    return {
        "status": "normalized",
        "normalized_value_molar": molar,
        "normalized_unit": "M",
        "canonical_input_unit": canonical_unit,
        "transformed_endpoint": CONCENTRATION_ENDPOINTS[endpoint_key],
        "transformed_value": transformed,
        "transformed_relation": REVERSED_RELATIONS[relation_text],
        "transform": "-log10(concentration_molar)",
        "normalization_version": NORMALIZATION_VERSION,
    }


def deterministic_identifier(namespace: str, *parts: object) -> str:
    payload = json.dumps([namespace, *parts], ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def build_molecule_link_index(records: Sequence[Mapping[str, object]]) -> dict[str, object]:
    by_id: dict[str, list[dict[str, object]]] = defaultdict(list)
    by_structure: dict[str, list[dict[str, object]]] = defaultdict(list)
    for source in records:
        record = dict(source)
        if str(record.get("validation_status") or "") != "valid":
            continue
        molecule_id = str(record.get("molecule_id") or "").strip()
        canonical = str(record.get("canonical_smiles") or "").strip()
        if molecule_id:
            by_id[molecule_id].append(record)
        if canonical:
            by_structure[canonical].append(record)
    return {"by_id": dict(by_id), "by_structure": dict(by_structure)}


def parse_experimental_delimited(
    content: bytes,
    filename: str,
    molecule_records: Sequence[Mapping[str, object]],
    column_mapping: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """Parse, validate, normalize, and link a CSV/TSV without persisting it."""

    suffix = Path(filename).suffix.lower()
    if suffix not in {".csv", ".tsv"}:
        raise ValueError("Experimental measurement import supports CSV and TSV files only.")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("Experimental measurement files must be UTF-8 compatible.") from exc
    dialect = "excel-tab" if suffix == ".tsv" else "excel"
    reader = csv.DictReader(io.StringIO(text), dialect=dialect)
    if not reader.fieldnames:
        raise ValueError("Experimental measurement file has no header row.")
    resolved_mapping = resolve_column_mapping(reader.fieldnames, column_mapping or {})
    link_index = build_molecule_link_index(molecule_records)
    source_sha256 = hashlib.sha256(content).hexdigest()
    rows = [dict(row) for row in reader]
    duplicate_keys = Counter(
        (
            _read(row, resolved_mapping, "source"),
            _read(row, resolved_mapping, "source_record_id"),
        )
        for row in rows
        if _read(row, resolved_mapping, "source_record_id")
    )
    duplicate_values: dict[tuple[str, str], set[str]] = defaultdict(set)
    for row in rows:
        key = (_read(row, resolved_mapping, "source"), _read(row, resolved_mapping, "source_record_id"))
        if key[1]:
            duplicate_values[key].add(_read(row, resolved_mapping, "value"))

    measurements = [
        normalize_measurement_row(
            row,
            row_number=index,
            mapping=resolved_mapping,
            link_index=link_index,
            source_sha256=source_sha256,
            duplicate_keys=duplicate_keys,
            duplicate_values=duplicate_values,
        )
        for index, row in enumerate(rows, start=2)
    ]
    summary = summarize_measurements(measurements)
    return {
        "schema_version": SCHEMA_VERSION,
        "normalization_version": NORMALIZATION_VERSION,
        "source_filename": Path(filename).name,
        "source_sha256": source_sha256,
        "column_mapping": resolved_mapping,
        "measurements": measurements,
        "summary": summary,
    }


def resolve_column_mapping(fieldnames: Sequence[str], requested: Mapping[str, str]) -> dict[str, str]:
    actual = {str(name).strip().lower(): str(name) for name in fieldnames if name is not None}
    resolved: dict[str, str] = {}
    for logical, aliases in COLUMN_ALIASES.items():
        explicit = str(requested.get(logical) or "").strip()
        if explicit:
            if explicit not in fieldnames:
                raise ValueError(f"Mapped column '{explicit}' for {logical} is not present.")
            resolved[logical] = explicit
            continue
        match = next((actual[alias] for alias in aliases if alias in actual), "")
        if match:
            resolved[logical] = match
    required = {"endpoint", "value", "unit", "relation", "source", "source_record_id"}
    missing = sorted(required - resolved.keys())
    if "molecule_id" not in resolved and "smiles" not in resolved:
        missing.append("molecule_id or smiles")
    if missing:
        raise ValueError(f"Missing required experimental columns: {', '.join(missing)}.")
    return resolved


def normalize_measurement_row(
    row: Mapping[str, object], *, row_number: int, mapping: Mapping[str, str],
    link_index: Mapping[str, object], source_sha256: str,
    duplicate_keys: Mapping[tuple[str, str], int],
    duplicate_values: Mapping[tuple[str, str], set[str]],
) -> dict[str, object]:
    original = {str(key): "" if value is None else str(value) for key, value in row.items()}
    endpoint_input = _read(row, mapping, "endpoint")
    endpoint_key = canonical_endpoint(endpoint_input)
    value_text = _read(row, mapping, "value")
    unit_text = _read(row, mapping, "unit")
    relation = _read(row, mapping, "relation")
    source = _read(row, mapping, "source")
    source_record_id = _read(row, mapping, "source_record_id")
    errors: list[str] = []
    flags = ["experimental_endpoint"]
    if relation not in SUPPORTED_RELATIONS:
        errors.append("unsupported_relation")
    try:
        numeric_value = float(value_text)
        if not math.isfinite(numeric_value):
            raise ValueError
    except (TypeError, ValueError):
        numeric_value = None
        errors.append("invalid_numeric_value")
    if not source:
        errors.append("missing_source")
    if not source_record_id:
        errors.append("missing_source_record_id")
    if relation and relation != "=":
        flags.append("censored_value")

    supported_kind = (
        "concentration" if endpoint_key in CONCENTRATION_ENDPOINTS
        else "percentage" if endpoint_key in PERCENTAGE_ENDPOINTS
        else "unsupported"
    )
    normalization: dict[str, object] = {"status": "not_applicable", "reason": "not_concentration_endpoint"}
    if supported_kind == "concentration":
        normalization = normalize_concentration(endpoint_key, value_text, unit_text, relation)
        if normalization["status"] == "invalid":
            reason = str(normalization["reason"])
            errors.append(reason)
            if reason == "unsupported_unit_conversion":
                flags.append(reason)
    elif supported_kind == "percentage":
        if unit_text.strip().lower() not in {"%", "percent", "percentage"}:
            errors.append("unsupported_percentage_unit")
    else:
        errors.append("unsupported_endpoint_type")

    linkage = link_measurement(row, mapping, link_index)
    if linkage["status"] != "linked":
        errors.append(f"{linkage['status']}_molecule_link")
    elif linkage.get("identity_mismatch"):
        errors.append("structure_identity_mismatch")

    uncertainty = _uncertainty(row, mapping)
    if uncertainty["type"] == "unknown":
        flags.append("missing_uncertainty")
    replicate_count = _optional_int(_read(row, mapping, "replicate_count"))
    if replicate_count is not None and replicate_count < 2:
        flags.append("insufficient_replicates")
    metadata_missing = [
        name for name in ("organism", "assay_id", "assay_type", "assay_system", "biological_mode")
        if not _read(row, mapping, name)
    ]
    if not (_read(row, mapping, "target_identifier") or _read(row, mapping, "target_name")):
        metadata_missing.append("target")
    if metadata_missing:
        flags.append("incompatible_assay_metadata")

    duplicate_key = (source, source_record_id)
    if source_record_id and duplicate_keys.get(duplicate_key, 0) > 1:
        flags.append("potential_repeat_citation")
        if len(duplicate_values.get(duplicate_key, set())) > 1:
            flags.append("duplicate_conflicting_measurements")

    identity = _structure_identity(row, mapping, linkage)
    flags.extend(identity.pop("quality_flags"))
    measurement_id = deterministic_identifier(
        "experimental-measurement", source_sha256, row_number, source, source_record_id,
    )
    optional = {
        name: _read(row, mapping, name)
        for name in (
            "cell_line", "tissue", "substrate", "test_concentration", "test_concentration_unit",
            "exposure_time", "temperature", "ph", "electrophysiology_protocol",
            "electrophysiology_readout", "experimental_batch", "measurement_date", "operator",
            "citation", "comments", "replicate_id", "replicate_type",
        )
        if _read(row, mapping, name)
    }
    result = {
        "measurement_id": measurement_id,
        "row_number": row_number,
        "validation_status": "valid" if not errors else "invalid",
        "validation_errors": sorted(set(errors)),
        "quality_flags": sorted(set(flags)),
        "molecule_id": linkage.get("molecule_id"),
        "structure_identity_id": identity["structure_identity_id"],
        "structure_identity": identity,
        "linkage": linkage,
        "endpoint_id": endpoint_key,
        "endpoint_name": endpoint_input,
        "measurement_type": endpoint_key,
        "endpoint_kind": supported_kind,
        "target": {
            "identifier": _read(row, mapping, "target_identifier"),
            "name": _read(row, mapping, "target_name"),
            "organism": _read(row, mapping, "organism"),
            "construct_or_isoform": _read(row, mapping, "construct_or_isoform"),
        },
        "assay_id": _read(row, mapping, "assay_id"),
        "assay_protocol_version": _read(row, mapping, "assay_protocol_version"),
        "assay_type": _read(row, mapping, "assay_type"),
        "assay_system": _read(row, mapping, "assay_system"),
        "biological_mode": _read(row, mapping, "biological_mode"),
        "readout": _read(row, mapping, "readout"),
        "original_value": numeric_value if numeric_value is not None else value_text,
        "original_value_text": value_text,
        "original_unit": unit_text,
        "relation": relation,
        "normalization": normalization,
        "experimental": True,
        "source": source,
        "source_record_id": source_record_id,
        "replicate_count": replicate_count,
        "uncertainty": uncertainty,
        "optional_metadata": optional,
        "source_row": original,
    }
    return result


def link_measurement(
    row: Mapping[str, object], mapping: Mapping[str, str], link_index: Mapping[str, object],
) -> dict[str, object]:
    requested_id = _read(row, mapping, "molecule_id")
    submitted_smiles = _read(row, mapping, "smiles")
    if requested_id:
        candidates = list(dict(link_index["by_id"]).get(requested_id, []))
        if len(candidates) == 1:
            candidate = candidates[0]
            mismatch = False
            if submitted_smiles:
                standardized = standardize_smiles(submitted_smiles)
                mismatch = bool(
                    standardized.canonical_smiles
                    and standardized.canonical_smiles != candidate.get("canonical_smiles")
                )
            return _linked(candidate, "molecule_id", mismatch)
        return {"status": "ambiguous" if len(candidates) > 1 else "unmatched", "method": "molecule_id", "requested_molecule_id": requested_id}
    if submitted_smiles:
        standardized = standardize_smiles(submitted_smiles)
        if not standardized.valid_molecule or not standardized.canonical_smiles:
            return {"status": "unmatched", "method": "canonical_isomeric_smiles", "reason": "invalid_smiles"}
        candidates = list(dict(link_index["by_structure"]).get(standardized.canonical_smiles, []))
        if len(candidates) == 1:
            return _linked(candidates[0], "canonical_isomeric_smiles", False)
        return {
            "status": "ambiguous" if len(candidates) > 1 else "unmatched",
            "method": "canonical_isomeric_smiles",
            "submitted_standardized_parent": standardized.canonical_smiles,
            "candidate_molecule_ids": [str(item.get("molecule_id") or "") for item in candidates],
        }
    return {"status": "unmatched", "method": "none", "reason": "missing_molecule_identifier"}


def summarize_measurements(measurements: Sequence[Mapping[str, object]]) -> dict[str, object]:
    endpoints = Counter(str(item.get("endpoint_id") or "") for item in measurements)
    unit_problems = sum(
        "unsupported_unit_conversion" in list(item.get("validation_errors") or [])
        or "unsupported_percentage_unit" in list(item.get("validation_errors") or [])
        for item in measurements
    )
    return {
        "row_count": len(measurements),
        "valid_measurements": sum(item.get("validation_status") == "valid" for item in measurements),
        "invalid_measurements": sum(item.get("validation_status") != "valid" for item in measurements),
        "linked_molecules": sum(dict(item.get("linkage") or {}).get("status") == "linked" for item in measurements),
        "unmatched_molecules": sum(dict(item.get("linkage") or {}).get("status") == "unmatched" for item in measurements),
        "ambiguous_links": sum(dict(item.get("linkage") or {}).get("status") == "ambiguous" for item in measurements),
        "supported_endpoints": sorted(key for key in endpoints if key in CONCENTRATION_ENDPOINTS or key in PERCENTAGE_ENDPOINTS),
        "unsupported_endpoint_types": sorted(key for key in endpoints if key not in CONCENTRATION_ENDPOINTS and key not in PERCENTAGE_ENDPOINTS),
        "unit_problems": unit_problems,
        "censored_values": sum("censored_value" in list(item.get("quality_flags") or []) for item in measurements),
        "missing_required_metadata": sum("incompatible_assay_metadata" in list(item.get("quality_flags") or []) for item in measurements),
        "duplicate_source_records": sum("potential_repeat_citation" in list(item.get("quality_flags") or []) for item in measurements),
        "endpoint_counts": dict(sorted(endpoints.items())),
    }


def _structure_identity(
    row: Mapping[str, object], mapping: Mapping[str, str], linkage: Mapping[str, object],
) -> dict[str, object]:
    submitted = _read(row, mapping, "smiles")
    linked_record = dict(linkage.get("record") or {})
    original = submitted or str(linked_record.get("input_smiles") or linked_record.get("canonical_smiles") or "")
    canonical_isomeric = ""
    ambiguous_stereo = False
    if original:
        molecule = Chem.MolFromSmiles(original)
        if molecule is not None:
            canonical_isomeric = Chem.MolToSmiles(molecule, canonical=True, isomericSmiles=True)
            try:
                ambiguous_stereo = any(
                    str(info.specified).lower().endswith("unspecified")
                    for info in Chem.FindPotentialStereo(molecule)
                )
            except Exception:
                ambiguous_stereo = False
    standardized_parent = str(linked_record.get("canonical_smiles") or "")
    flags = []
    if ambiguous_stereo:
        flags.append("ambiguous_stereochemistry")
    if canonical_isomeric and standardized_parent and canonical_isomeric != standardized_parent:
        flags.append("parent_identity_collapsed")
    identity_basis = canonical_isomeric or standardized_parent or original
    return {
        "structure_identity_id": deterministic_identifier("experimental-structure", identity_basis),
        "original_submitted_structure": original,
        "canonical_isomeric_smiles": canonical_isomeric,
        "standardized_parent_smiles": standardized_parent,
        "standardization_algorithm": "MolOptima standardize_smiles (RDKit Cleanup, FragmentParent, Uncharger)",
        "standardization_version": "moloptima-standardization-v1",
        "quality_flags": flags,
    }


def _uncertainty(row: Mapping[str, object], mapping: Mapping[str, str]) -> dict[str, object]:
    raw_type = _read(row, mapping, "uncertainty_type").upper() or "UNKNOWN"
    uncertainty_type = raw_type if raw_type in UNCERTAINTY_TYPES else "UNKNOWN"
    return {
        "type": uncertainty_type.lower(),
        "value": _optional_float(_read(row, mapping, "uncertainty_value")),
        "lower": _optional_float(_read(row, mapping, "uncertainty_lower")),
        "upper": _optional_float(_read(row, mapping, "uncertainty_upper")),
        "confidence_level": _optional_float(_read(row, mapping, "confidence_level")),
        "scale": _read(row, mapping, "uncertainty_scale") or "unknown",
        "replicate_count": _optional_int(_read(row, mapping, "replicate_count")),
    }


def _linked(record: Mapping[str, object], method: str, mismatch: bool) -> dict[str, object]:
    public = dict(record)
    return {
        "status": "linked",
        "method": method,
        "molecule_id": str(public.get("molecule_id") or ""),
        "canonical_smiles": str(public.get("canonical_smiles") or ""),
        "identity_mismatch": mismatch,
        "record": public,
    }


def _read(row: Mapping[str, object], mapping: Mapping[str, str], logical: str) -> str:
    column = mapping.get(logical)
    return str(row.get(column, "") if column else "").strip()


def _optional_float(value: str) -> float | None:
    if not value:
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except ValueError:
        return None


def _optional_int(value: str) -> int | None:
    if not value:
        return None
    try:
        number = int(value)
        return number if number >= 0 else None
    except ValueError:
        return None
