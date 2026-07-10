"""Target-driven active/reference compound discovery and comparison."""

from __future__ import annotations

import csv
import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rdkit import Chem, DataStructs
from rdkit.Chem import AllChem


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TARGET_REFERENCE_CACHE_DIR = PROJECT_ROOT / "app_data" / "public_lookup_cache" / "target_references"
LOCAL_TARGET_REFERENCE_FILE = PROJECT_ROOT / "data" / "target_references" / "target_active_references.csv"
CHEMBL_BASE_URL = "https://www.ebi.ac.uk/chembl/api/data"

TARGET_REFERENCE_COLUMNS = [
    "target_reference_status",
    "target_reference_source",
    "target_reference_count",
    "nearest_active_reference_id",
    "nearest_active_compound_name",
    "nearest_active_similarity",
    "nearest_active_activity_class",
    "nearest_active_mechanism_class",
    "nearest_active_activity_type",
    "nearest_active_activity_value",
    "nearest_active_activity_units",
    "active_neighborhood_signal",
    "active_neighborhood_summary",
]


@dataclass(frozen=True)
class TargetContext:
    """Target context supplied by a prioritization run."""

    target_name: str = ""
    target_gene_symbol: str = ""
    target_uniprot_id: str = ""
    target_chembl_id: str = ""
    pdb_id: str = ""
    organism: str = ""
    disease_context: str = ""
    mechanism_context: str = ""
    docking_protocol_notes: str = ""
    binding_site_notes: str = ""


@dataclass(frozen=True)
class TargetReference:
    """One structured target-active/reference compound."""

    reference_id: str
    target_name: str
    target_gene_symbol: str
    target_chembl_id: str
    compound_name: str
    smiles: str
    canonical_smiles: str | None
    activity_class: str
    activity_type: str
    activity_value: str
    activity_units: str
    mechanism_class: str
    reference_source: str
    notes: str = ""
    target_organism: str = ""
    cache_status: str = "not_cached"
    chemical_space_x: float | None = None
    chemical_space_y: float | None = None
    chemical_space_status: str = "not_projected"


@dataclass(frozen=True)
class TargetReferenceSet:
    """Reference discovery output used by pipeline and frontend."""

    enabled: bool
    lookup_status: str
    cache_status: str
    source: str
    resolved_target_chembl_id: str | None
    resolved_target_name: str | None
    warning: str
    references: list[TargetReference]


def target_context_from_mapping(mapping: dict[str, object] | None) -> TargetContext:
    values = mapping or {}
    return TargetContext(
        target_name=_clean(values.get("target_name")),
        target_gene_symbol=_clean(values.get("target_gene_symbol")),
        target_uniprot_id=_clean(values.get("target_uniprot_id")),
        target_chembl_id=_clean(values.get("target_chembl_id")),
        pdb_id=_clean(values.get("pdb_id")),
        organism=_clean(values.get("organism")),
        disease_context=_clean(values.get("disease_context")),
        mechanism_context=_clean(values.get("mechanism_context")),
        docking_protocol_notes=_clean(values.get("docking_protocol_notes")),
        binding_site_notes=_clean(values.get("binding_site_notes")),
    )


def empty_target_reference_fields(status: str = "not_requested") -> dict[str, object]:
    return {
        "target_reference_status": status,
        "target_reference_source": "not_used",
        "target_reference_count": None,
        "nearest_active_reference_id": None,
        "nearest_active_compound_name": None,
        "nearest_active_similarity": None,
        "nearest_active_activity_class": None,
        "nearest_active_mechanism_class": None,
        "nearest_active_activity_type": None,
        "nearest_active_activity_value": None,
        "nearest_active_activity_units": None,
        "active_neighborhood_signal": status if status == "not_run_invalid_molecule" else "not_requested",
        "active_neighborhood_summary": "Target-reference discovery was not requested.",
    }


class TargetReferenceClient:
    """ChEMBL target/activity lookup with local cache and curated CSV supplement."""

    def __init__(
        self,
        *,
        cache_dir: Path | None = None,
        local_reference_file: Path | None = None,
        timeout_seconds: float = 10.0,
        base_url: str = CHEMBL_BASE_URL,
        max_references: int = 40,
    ) -> None:
        self.cache_dir = cache_dir or TARGET_REFERENCE_CACHE_DIR
        self.local_reference_file = local_reference_file or LOCAL_TARGET_REFERENCE_FILE
        self.timeout_seconds = timeout_seconds
        self.base_url = base_url.rstrip("/")
        self.max_references = max_references

    def discover_references(self, context: TargetContext) -> TargetReferenceSet:
        if not _has_target_context(context):
            local_references = load_local_target_references(context, self.local_reference_file)
            return TargetReferenceSet(
                enabled=True,
                lookup_status="missing_target_context" if not local_references else "local_references_loaded",
                cache_status="not_used",
                source="local_curated" if local_references else "none",
                resolved_target_chembl_id=None,
                resolved_target_name=None,
                warning="" if local_references else "Target-reference discovery requested without target context.",
                references=local_references[: self.max_references],
            )

        cache_key = _target_cache_key(context)
        cached_payload = self._read_cache(cache_key)
        if cached_payload is not None:
            cached_set = self._reference_set_from_payload(cached_payload)
            return TargetReferenceSet(
                **{
                    **asdict(cached_set),
                    "cache_status": "cache_hit",
                    "references": [
                        TargetReference(**{**asdict(reference), "cache_status": "cache_hit"})
                        for reference in cached_set.references
                    ],
                }
            )

        try:
            chembl_references, target_id, target_name = self._fetch_chembl_references(context)
            lookup_status = "references_found" if chembl_references else "no_chembl_references"
            warning = ""
        except Exception as exc:
            chembl_references = []
            target_id = context.target_chembl_id or None
            target_name = context.target_name or None
            lookup_status = "lookup_failed"
            warning = str(exc)

        local_references = load_local_target_references(context, self.local_reference_file)
        references = _dedupe_references([*chembl_references, *local_references])[: self.max_references]
        source = _reference_source_label(bool(chembl_references), bool(local_references))
        if lookup_status == "lookup_failed" and local_references:
            lookup_status = "lookup_failed_local_references_loaded"

        result = TargetReferenceSet(
            enabled=True,
            lookup_status=lookup_status,
            cache_status="fresh_lookup",
            source=source,
            resolved_target_chembl_id=target_id,
            resolved_target_name=target_name,
            warning=warning,
            references=references,
        )
        self._write_cache(cache_key, result)
        return result

    def _fetch_chembl_references(
        self,
        context: TargetContext,
    ) -> tuple[list[TargetReference], str | None, str | None]:
        target = self._resolve_target(context)
        if target is None:
            return [], None, None

        target_id = str(target.get("target_chembl_id") or "").strip()
        target_name = str(target.get("pref_name") or "").strip()
        if not target_id:
            return [], None, target_name or None

        activity_url = (
            f"{self.base_url}/activity.json?"
            f"target_chembl_id={urllib.parse.quote(target_id, safe='')}"
            "&standard_relation__in=%3D&limit=100"
            "&only=molecule_chembl_id,canonical_smiles,standard_type,standard_value,standard_units,pchembl_value,target_chembl_id,target_pref_name,target_organism"
        )
        payload = self._get_json(activity_url)
        activities = payload.get("activities", [])
        references: list[TargetReference] = []
        seen: set[str] = set()
        for activity in activities:
            if not isinstance(activity, dict):
                continue
            smiles = _clean(activity.get("canonical_smiles"))
            molecule_id = _clean(activity.get("molecule_chembl_id"))
            if not smiles or not molecule_id or molecule_id in seen:
                continue
            canonical = _canonical_smiles(smiles)
            if not canonical:
                continue
            seen.add(molecule_id)
            pchembl = _clean(activity.get("pchembl_value"))
            references.append(
                TargetReference(
                    reference_id=molecule_id,
                    target_name=_clean(activity.get("target_pref_name")) or target_name,
                    target_gene_symbol=context.target_gene_symbol,
                    target_chembl_id=target_id,
                    compound_name=molecule_id,
                    smiles=smiles,
                    canonical_smiles=canonical,
                    activity_class=_activity_class(pchembl, _clean(activity.get("standard_value"))),
                    activity_type=_clean(activity.get("standard_type")),
                    activity_value=pchembl or _clean(activity.get("standard_value")),
                    activity_units="pChEMBL" if pchembl else _clean(activity.get("standard_units")),
                    mechanism_class=context.mechanism_context or "unknown",
                    reference_source="ChEMBL",
                    notes="ChEMBL target activity reference.",
                    target_organism=_clean(activity.get("target_organism")),
                    cache_status="fresh_lookup",
                )
            )
        return _rank_references(references)[: self.max_references], target_id, target_name or None

    def _resolve_target(self, context: TargetContext) -> dict[str, Any] | None:
        if context.target_chembl_id:
            payload = self._get_json(
                f"{self.base_url}/target/{urllib.parse.quote(context.target_chembl_id, safe='')}.json"
            )
            return payload if payload.get("target_chembl_id") else None

        if context.target_uniprot_id:
            component_url = (
                f"{self.base_url}/target_component.json?"
                f"accession={urllib.parse.quote(context.target_uniprot_id, safe='')}&limit=1"
            )
            components = self._get_json(component_url).get("target_components", [])
            if components:
                targets = components[0].get("targets") or []
                if targets:
                    return targets[0]

        query = context.target_gene_symbol or context.target_name
        if query:
            target_url = (
                f"{self.base_url}/target/search.json?"
                f"q={urllib.parse.quote(query, safe='')}&limit=1"
            )
            targets = self._get_json(target_url).get("targets", [])
            if targets:
                return targets[0]
        return None

    def _get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": "MolOptima/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            raise RuntimeError(f"ChEMBL target lookup failed with HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"ChEMBL target lookup unavailable: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("ChEMBL target lookup returned invalid JSON.") from exc
        return payload if isinstance(payload, dict) else {}

    def _cache_path(self, cache_key: str) -> Path:
        digest = hashlib.sha256(cache_key.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _read_cache(self, cache_key: str) -> dict[str, Any] | None:
        path = self._cache_path(cache_key)
        if not path.exists():
            return None
        try:
            with path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    def _write_cache(self, cache_key: str, result: TargetReferenceSet) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "target_references",
            "cache_key": cache_key,
            "cached_at": utc_timestamp(),
            "result": asdict(result),
        }
        with self._cache_path(cache_key).open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")

    def _reference_set_from_payload(self, payload: dict[str, Any]) -> TargetReferenceSet:
        result = payload.get("result")
        if not isinstance(result, dict):
            return TargetReferenceSet(
                enabled=True,
                lookup_status="lookup_failed",
                cache_status="cache_hit",
                source="none",
                resolved_target_chembl_id=None,
                resolved_target_name=None,
                warning="Cached target-reference payload was malformed.",
                references=[],
            )
        raw_references = result.get("references")
        references = [
            _reference_from_mapping(item)
            for item in (raw_references if isinstance(raw_references, list) else [])
            if isinstance(item, dict)
        ]
        return TargetReferenceSet(
            enabled=bool(result.get("enabled", True)),
            lookup_status=str(result.get("lookup_status") or "lookup_failed"),
            cache_status=str(result.get("cache_status") or "cache_hit"),
            source=str(result.get("source") or "none"),
            resolved_target_chembl_id=result.get("resolved_target_chembl_id"),
            resolved_target_name=result.get("resolved_target_name"),
            warning=str(result.get("warning") or ""),
            references=references,
        )


def load_local_target_references(
    context: TargetContext,
    path: Path | None = None,
) -> list[TargetReference]:
    reference_path = path or LOCAL_TARGET_REFERENCE_FILE
    if not reference_path.exists():
        return []

    references: list[TargetReference] = []
    with reference_path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            if not _local_reference_matches_context(row, context):
                continue
            smiles = _clean(row.get("smiles"))
            canonical = _canonical_smiles(smiles)
            if not canonical:
                continue
            references.append(
                TargetReference(
                    reference_id=_clean(row.get("reference_id")) or _clean(row.get("compound_name")) or canonical,
                    target_name=_clean(row.get("target_name")),
                    target_gene_symbol=_clean(row.get("target_gene_symbol")),
                    target_chembl_id=_clean(row.get("target_chembl_id")),
                    compound_name=_clean(row.get("compound_name")) or _clean(row.get("reference_id")),
                    smiles=smiles,
                    canonical_smiles=canonical,
                    activity_class=_clean(row.get("activity_class")) or "reference_ligand",
                    activity_type=_clean(row.get("activity_type")),
                    activity_value=_clean(row.get("activity_value")),
                    activity_units=_clean(row.get("activity_units")),
                    mechanism_class=_clean(row.get("mechanism_class")) or "unknown",
                    reference_source=_clean(row.get("reference_source")) or "local_curated",
                    notes=_clean(row.get("notes")),
                )
            )
    return references


def add_target_reference_analysis(
    rows: list[dict[str, object]],
    reference_set: TargetReferenceSet | None,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    annotated = [{**row} for row in rows]
    if reference_set is None or not reference_set.enabled:
        for row in annotated:
            row.update(empty_target_reference_fields())
        return annotated, []

    references = [reference for reference in reference_set.references if reference.canonical_smiles]
    reference_fingerprints = _reference_fingerprints(references)
    reference_count = len(reference_fingerprints)
    reference_source = reference_set.source

    for row in annotated:
        smiles = _clean(row.get("canonical_smiles") or row.get("input_smiles"))
        if row.get("valid_molecule") is not True or not smiles:
            row.update(empty_target_reference_fields("not_run_invalid_molecule"))
            row["target_reference_source"] = reference_source
            row["target_reference_count"] = reference_count
            row["active_neighborhood_summary"] = "Target-reference comparison skipped for invalid molecule."
            continue
        if reference_set.lookup_status.startswith("lookup_failed") and reference_count == 0:
            row.update(_target_lookup_failed_fields(reference_set))
            continue
        if reference_count == 0:
            row.update(_no_reference_fields(reference_set))
            continue

        molecule = Chem.MolFromSmiles(smiles)
        if molecule is None:
            row.update(empty_target_reference_fields("not_run_invalid_molecule"))
            row["target_reference_source"] = reference_source
            row["target_reference_count"] = reference_count
            continue

        fingerprint = AllChem.GetMorganFingerprintAsBitVect(molecule, radius=2, nBits=2048)
        best_reference, best_similarity = _nearest_reference(fingerprint, reference_fingerprints)
        row.update(_comparison_fields(reference_set, best_reference, best_similarity, reference_count))

    projected_references = project_candidates_and_references(annotated, references)
    return annotated, projected_references


def project_candidates_and_references(
    rows: list[dict[str, object]],
    references: list[TargetReference],
) -> list[dict[str, object]]:
    """Project valid candidates and target references together in the same PCA space."""

    import numpy as np

    items: list[tuple[str, int | None, TargetReference | None, object]] = []
    for index, row in enumerate(rows):
        smiles = _clean(row.get("canonical_smiles") or row.get("input_smiles"))
        if row.get("valid_molecule") is True and smiles:
            molecule = Chem.MolFromSmiles(smiles)
            if molecule is not None:
                items.append(("candidate", index, None, AllChem.GetMorganFingerprintAsBitVect(molecule, 2, nBits=2048)))
    for reference in references:
        if reference.canonical_smiles:
            molecule = Chem.MolFromSmiles(reference.canonical_smiles)
            if molecule is not None:
                items.append(("reference", None, reference, AllChem.GetMorganFingerprintAsBitVect(molecule, 2, nBits=2048)))

    if not items:
        return []
    if len(items) == 1:
        coordinates = [(0.0, 0.0)]
        warning = "Only one valid candidate/reference molecule available; point placed at origin."
    else:
        matrix = np.vstack([_fingerprint_array(fingerprint) for *_prefix, fingerprint in items])
        centered = matrix - matrix.mean(axis=0)
        _u, _singular_values, vt = np.linalg.svd(centered, full_matrices=False)
        components = vt[:2]
        projected = centered @ components.T
        if projected.shape[1] == 1:
            projected = np.column_stack([projected[:, 0], np.zeros(projected.shape[0])])
        coordinates = [(round(float(x), 6), round(float(y), 6)) for x, y in projected[:, :2]]
        warning = ""

    reference_points: list[dict[str, object]] = []
    for item, (x_value, y_value) in zip(items, coordinates):
        kind, row_index, reference, _fingerprint = item
        if kind == "candidate" and row_index is not None:
            rows[row_index].update(
                {
                    "chemical_space_x": x_value,
                    "chemical_space_y": y_value,
                    "chemical_space_status": "projected_with_target_references",
                    "chemical_space_method": "morgan_fingerprint_joint_target_reference_pca",
                    "chemical_space_warning": warning,
                }
            )
        elif reference is not None:
            reference_points.append(
                {
                    **asdict(reference),
                    "chemical_space_x": x_value,
                    "chemical_space_y": y_value,
                    "chemical_space_status": "projected_with_candidates",
                    "point_type": "target_reference",
                }
            )
    return reference_points


def target_reference_metadata(
    reference_set: TargetReferenceSet | None,
    reference_points: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    if reference_set is None:
        return {
            "enabled": False,
            "lookup_status": "not_requested",
            "cache_status": "not_used",
            "source": "not_used",
            "resolved_target_chembl_id": None,
            "resolved_target_name": None,
            "reference_count": 0,
            "warning": "",
            "references": [],
        }
    return {
        "enabled": reference_set.enabled,
        "lookup_status": reference_set.lookup_status,
        "cache_status": reference_set.cache_status,
        "source": reference_set.source,
        "resolved_target_chembl_id": reference_set.resolved_target_chembl_id,
        "resolved_target_name": reference_set.resolved_target_name,
        "reference_count": len(reference_set.references),
        "warning": reference_set.warning,
        "references": reference_points or [asdict(reference) for reference in reference_set.references],
    }


def _reference_fingerprints(references: list[TargetReference]) -> list[tuple[TargetReference, object]]:
    fingerprints = []
    for reference in references:
        if not reference.canonical_smiles:
            continue
        molecule = Chem.MolFromSmiles(reference.canonical_smiles)
        if molecule is not None:
            fingerprints.append((reference, AllChem.GetMorganFingerprintAsBitVect(molecule, 2, nBits=2048)))
    return fingerprints


def _nearest_reference(
    fingerprint: object,
    reference_fingerprints: list[tuple[TargetReference, object]],
) -> tuple[TargetReference, float]:
    best_reference = reference_fingerprints[0][0]
    best_similarity = -1.0
    for reference, reference_fingerprint in reference_fingerprints:
        similarity = DataStructs.TanimotoSimilarity(fingerprint, reference_fingerprint)
        if similarity > best_similarity or (
            similarity == best_similarity and reference.reference_id < best_reference.reference_id
        ):
            best_reference = reference
            best_similarity = similarity
    return best_reference, round(best_similarity, 3)


def _comparison_fields(
    reference_set: TargetReferenceSet,
    reference: TargetReference,
    similarity: float,
    reference_count: int,
) -> dict[str, object]:
    signal = _active_neighborhood_signal(similarity)
    return {
        "target_reference_status": reference_set.lookup_status,
        "target_reference_source": reference_set.source,
        "target_reference_count": reference_count,
        "nearest_active_reference_id": reference.reference_id,
        "nearest_active_compound_name": reference.compound_name,
        "nearest_active_similarity": similarity,
        "nearest_active_activity_class": reference.activity_class,
        "nearest_active_mechanism_class": reference.mechanism_class,
        "nearest_active_activity_type": reference.activity_type,
        "nearest_active_activity_value": reference.activity_value,
        "nearest_active_activity_units": reference.activity_units,
        "active_neighborhood_signal": signal,
        "active_neighborhood_summary": (
            f"Nearest target reference is {reference.compound_name or reference.reference_id} "
            f"with Morgan fingerprint similarity {similarity}."
        ),
    }


def _no_reference_fields(reference_set: TargetReferenceSet) -> dict[str, object]:
    return {
        **empty_target_reference_fields(),
        "target_reference_status": reference_set.lookup_status,
        "target_reference_source": reference_set.source,
        "target_reference_count": 0,
        "active_neighborhood_signal": "no_reference_actives_available",
        "active_neighborhood_summary": "No usable target-active reference compounds were available.",
    }


def _target_lookup_failed_fields(reference_set: TargetReferenceSet) -> dict[str, object]:
    return {
        **_no_reference_fields(reference_set),
        "target_reference_status": "lookup_failed",
        "active_neighborhood_signal": "target_reference_lookup_failed",
        "active_neighborhood_summary": "Target-reference lookup failed; missing data is not interpreted as no overlap.",
    }


def _active_neighborhood_signal(similarity: float) -> str:
    if similarity >= 0.7:
        return "near_known_active_space"
    if similarity >= 0.4:
        return "moderate_active_space_overlap"
    return "distant_from_known_actives"


def _fingerprint_array(fingerprint: object):
    import numpy as np

    array = np.zeros((2048,), dtype=float)
    DataStructs.ConvertToNumpyArray(fingerprint, array)
    return array


def _activity_class(pchembl: str, standard_value: str) -> str:
    try:
        if pchembl and float(pchembl) >= 6:
            return "active"
        if pchembl and float(pchembl) < 5:
            return "weak_active"
    except ValueError:
        pass
    return "reference_ligand" if standard_value else "unknown"


def _rank_references(references: list[TargetReference]) -> list[TargetReference]:
    def sort_key(reference: TargetReference) -> tuple[int, float, str]:
        class_rank = {"active": 0, "reference_ligand": 1, "weak_active": 2, "unknown": 3}.get(
            reference.activity_class,
            4,
        )
        try:
            potency = -float(reference.activity_value)
        except ValueError:
            potency = 0.0
        return (class_rank, potency, reference.reference_id)

    return sorted(references, key=sort_key)


def _local_reference_matches_context(row: dict[str, str], context: TargetContext) -> bool:
    if not _has_target_context(context):
        return True
    comparisons = [
        (_clean(row.get("target_chembl_id")).lower(), context.target_chembl_id.lower()),
        (_clean(row.get("target_gene_symbol")).lower(), context.target_gene_symbol.lower()),
        (_clean(row.get("target_name")).lower(), context.target_name.lower()),
    ]
    return any(left and right and left == right for left, right in comparisons)


def _dedupe_references(references: list[TargetReference]) -> list[TargetReference]:
    deduped: list[TargetReference] = []
    seen: set[str] = set()
    for reference in references:
        key = reference.canonical_smiles or reference.reference_id
        if key in seen:
            continue
        seen.add(key)
        deduped.append(reference)
    return deduped


def _reference_from_mapping(values: dict[str, Any]) -> TargetReference:
    return TargetReference(
        reference_id=_clean(values.get("reference_id")),
        target_name=_clean(values.get("target_name")),
        target_gene_symbol=_clean(values.get("target_gene_symbol")),
        target_chembl_id=_clean(values.get("target_chembl_id")),
        compound_name=_clean(values.get("compound_name")),
        smiles=_clean(values.get("smiles")),
        canonical_smiles=_clean(values.get("canonical_smiles")) or None,
        activity_class=_clean(values.get("activity_class")),
        activity_type=_clean(values.get("activity_type")),
        activity_value=_clean(values.get("activity_value")),
        activity_units=_clean(values.get("activity_units")),
        mechanism_class=_clean(values.get("mechanism_class")),
        reference_source=_clean(values.get("reference_source")),
        notes=_clean(values.get("notes")),
        target_organism=_clean(values.get("target_organism")),
        cache_status=_clean(values.get("cache_status")) or "cache_hit",
        chemical_space_x=values.get("chemical_space_x"),
        chemical_space_y=values.get("chemical_space_y"),
        chemical_space_status=_clean(values.get("chemical_space_status")) or "not_projected",
    )


def _reference_source_label(has_chembl: bool, has_local: bool) -> str:
    if has_chembl and has_local:
        return "ChEMBL + local_curated"
    if has_chembl:
        return "ChEMBL"
    if has_local:
        return "local_curated"
    return "none"


def _target_cache_key(context: TargetContext) -> str:
    payload = json.dumps(asdict(context), sort_keys=True)
    return payload


def _has_target_context(context: TargetContext) -> bool:
    return any(
        [
            context.target_name,
            context.target_gene_symbol,
            context.target_uniprot_id,
            context.target_chembl_id,
        ]
    )


def _canonical_smiles(smiles: str) -> str | None:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return None
    return Chem.MolToSmiles(molecule, canonical=True)


def _clean(value: object) -> str:
    return str(value or "").strip()


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
