"""Source-independent known-analog search and experimental-neighborhood utilities."""

from __future__ import annotations

import hashlib
import json
import socket
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import rdkit
from rdkit import Chem, DataStructs
from rdkit.Chem.Scaffolds import MurckoScaffold

from biopharma_intelligence.identity import canonical_identity_key
from biopharma_intelligence.similarity import MORGAN_FP_SIZE, MORGAN_RADIUS, morgan_fingerprint
from molecular_prioritization.experimental_measurements import (
    canonical_endpoint,
    deterministic_identifier,
    normalize_concentration,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
KNOWN_ANALOG_CACHE_DIR = PROJECT_ROOT / "app_data" / "public_lookup_cache" / "known_analogs"
CHEMBL_BASE_URL = "https://www.ebi.ac.uk/chembl/api/data"
CHEMBL_COMPOUND_URL = "https://www.ebi.ac.uk/chembl/explore/compound"
ADAPTER_VERSION = "chembl-known-analogs-v1"
CONTRACT_VERSION = "moloptima-experimental-neighborhood-v1"
CACHE_TTL = timedelta(days=7)
SCIENTIFIC_NOTE = (
    "Experimental measurements shown here belong to known reference compounds, not to the "
    "selected MolOptima compound. Structural similarity provides context but does not establish "
    "equivalent biological activity."
)


class KnownSourceError(RuntimeError):
    """Typed public-source failure that can be displayed without losing local state."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class KnownCompoundSource(ABC):
    """Adapter boundary for a structured public compound source."""

    source_name: str

    @abstractmethod
    def exact_structure_search(self, canonical_smiles: str) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def similarity_candidates(self, canonical_smiles: str, limit: int) -> list[dict[str, Any]]:
        raise NotImplementedError

    @abstractmethod
    def fetch_compound(self, source_compound_id: str) -> dict[str, Any]:
        raise NotImplementedError

    @abstractmethod
    def fetch_experimental_records(self, source_compound_id: str, limit: int) -> dict[str, Any]:
        raise NotImplementedError


class ChEMBLKnownCompoundSource(KnownCompoundSource):
    """Bounded ChEMBL adapter using its official structured web services."""

    source_name = "ChEMBL"

    def __init__(
        self, *, base_url: str = CHEMBL_BASE_URL, timeout_seconds: float = 12.0,
        source_query_threshold: int = 40,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_seconds = timeout_seconds
        self.source_query_threshold = source_query_threshold

    def exact_structure_search(self, canonical_smiles: str) -> list[dict[str, Any]]:
        identity = canonical_identity_key(canonical_smiles)
        if not identity:
            raise KnownSourceError("invalid_query_structure", "The selected structure cannot be canonicalized.")
        url = (
            f"{self.base_url}/molecule.json?"
            f"molecule_structures__canonical_smiles__flexmatch={urllib.parse.quote(identity, safe='')}"
            "&limit=20"
        )
        payload = self._get_json(url)
        matches = []
        for item in _dict_items(payload, "molecules"):
            normalized = _normalize_compound(item)
            if normalized and canonical_identity_key(normalized["canonical_smiles"]) == identity:
                matches.append(normalized)
        return sorted(matches, key=lambda item: item["source_compound_id"])

    def similarity_candidates(self, canonical_smiles: str, limit: int) -> list[dict[str, Any]]:
        identity = canonical_identity_key(canonical_smiles)
        if not identity:
            raise KnownSourceError("invalid_query_structure", "The selected structure cannot be canonicalized.")
        request_limit = min(100, max(limit + 20, limit))
        url = (
            f"{self.base_url}/similarity/{urllib.parse.quote(identity, safe='')}/"
            f"{self.source_query_threshold}.json?limit={request_limit}"
        )
        payload = self._get_json(url)
        candidates = []
        for item in _dict_items(payload, "molecules"):
            normalized = _normalize_compound(item)
            if normalized:
                candidates.append(normalized)
        return candidates

    def fetch_compound(self, source_compound_id: str) -> dict[str, Any]:
        _validate_chembl_id(source_compound_id)
        payload = self._get_json(
            f"{self.base_url}/molecule/{urllib.parse.quote(source_compound_id, safe='')}.json"
        )
        normalized = _normalize_compound(payload)
        if not normalized:
            raise KnownSourceError("malformed_source_response", "ChEMBL returned no usable compound structure.")
        return normalized

    def fetch_experimental_records(self, source_compound_id: str, limit: int) -> dict[str, Any]:
        _validate_chembl_id(source_compound_id)
        fields = ",".join([
            "activity_id", "molecule_chembl_id", "target_chembl_id", "target_pref_name",
            "target_organism", "assay_chembl_id", "assay_type", "assay_description", "bao_label",
            "standard_type", "standard_value", "standard_units", "standard_relation", "pchembl_value",
            "document_chembl_id", "src_id", "data_validity_comment", "activity_comment",
        ])
        url = (
            f"{self.base_url}/activity.json?molecule_chembl_id="
            f"{urllib.parse.quote(source_compound_id, safe='')}&limit={limit}&only={fields}"
        )
        payload = self._get_json(url)
        return {
            "activities": _dict_items(payload, "activities"),
            "total_count": int(dict(payload.get("page_meta") or {}).get("total_count") or 0),
        }

    def _get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": "MolOptima/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            if exc.code == 429:
                raise KnownSourceError("rate_limited", "ChEMBL rate limited this request; retry later.") from exc
            if exc.code in {502, 503, 504}:
                raise KnownSourceError("source_unavailable", f"ChEMBL is unavailable (HTTP {exc.code}).") from exc
            raise KnownSourceError("source_error", f"ChEMBL request failed with HTTP {exc.code}.") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise KnownSourceError("timeout", "ChEMBL did not respond before the request timeout.") from exc
        except urllib.error.URLError as exc:
            reason = str(exc.reason).lower()
            code = "timeout" if "timed out" in reason else "offline"
            message = "The ChEMBL request timed out." if code == "timeout" else "ChEMBL is unreachable; check the network connection."
            raise KnownSourceError(code, message) from exc
        except json.JSONDecodeError as exc:
            raise KnownSourceError("malformed_source_response", "ChEMBL returned invalid JSON.") from exc
        if not isinstance(payload, dict):
            raise KnownSourceError("malformed_source_response", "ChEMBL returned an unexpected response shape.")
        return payload


def search_known_analogs(
    query_molecule: dict[str, Any], *, max_analogs: int = 25, refresh: bool = False,
    adapter: KnownCompoundSource | None = None, cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Search exact identities and analog candidates, then score structures locally."""

    adapter = adapter or ChEMBLKnownCompoundSource()
    query_smiles = str(query_molecule.get("canonical_smiles") or "").strip()
    query_identity = canonical_identity_key(query_smiles)
    if not query_identity or morgan_fingerprint(query_identity) is None:
        raise ValueError("The selected molecule does not have a usable canonical structure.")
    cache_root = cache_dir or KNOWN_ANALOG_CACHE_DIR
    params = {
        "source": adapter.source_name,
        "query_identity": query_identity,
        "query_type": "exact_then_similarity",
        "max_analogs": max_analogs,
        "source_query_threshold": getattr(adapter, "source_query_threshold", None),
        "adapter_version": ADAPTER_VERSION,
    }
    cache_path = _cache_path(cache_root, "search", params)
    if not refresh:
        cached = _read_cache(cache_path)
        if cached is not None:
            result = dict(cached["result"])
            result["search_provenance"] = {
                **dict(result.get("search_provenance") or {}),
                "cache_status": "cache_hit",
                "cached_at": cached.get("retrieved_at"),
            }
            return result

    retrieved_at = utc_timestamp()
    exact_source = adapter.exact_structure_search(query_identity)
    candidate_source = adapter.similarity_candidates(query_identity, max_analogs)
    query_fp = morgan_fingerprint(query_identity)
    exact_matches = []
    exact_ids = set()
    for source_item in exact_source:
        exact = _known_analog(source_item, query_identity, query_fp, exact_match=True, adapter=adapter)
        summary = adapter.fetch_experimental_records(exact["source_compound_id"], 100)
        exact["experimental_record_count"] = summary["total_count"]
        exact["target_count"] = len({
            str(item.get("target_chembl_id") or item.get("target_pref_name") or "")
            for item in summary["activities"] if item.get("target_chembl_id") or item.get("target_pref_name")
        })
        exact["counts_status"] = "source_record_total_and_bounded_first_100_target_count"
        exact_matches.append(exact)
        exact_ids.add(exact["source_compound_id"])
    analogs = []
    malformed_count = 0
    for source_item in candidate_source:
        if source_item.get("source_compound_id") in exact_ids:
            continue
        candidate = _known_analog(source_item, query_identity, query_fp, exact_match=False, adapter=adapter)
        if candidate is None:
            malformed_count += 1
            continue
        if candidate["moloptima_tanimoto"] >= 1.0:
            exact_matches.append({**candidate, "exact_match": True})
            exact_ids.add(candidate["source_compound_id"])
            continue
        analogs.append(candidate)
    exact_matches = _dedupe_compounds(exact_matches)
    analogs = [item for item in _dedupe_compounds(analogs) if item["source_compound_id"] not in exact_ids]
    analogs.sort(key=lambda item: (-item["moloptima_tanimoto"], item["source_compound_id"]))
    analogs = analogs[:max_analogs]
    result = {
        "contract_version": CONTRACT_VERSION,
        "query_molecule": {
            "molecule_id": query_molecule.get("molecule_id"),
            "display_name": query_molecule.get("display_name") or query_molecule.get("molecule_id"),
            "canonical_smiles": query_identity,
        },
        "source": adapter.source_name,
        "exact_match": bool(exact_matches),
        "exact_matches": exact_matches,
        "analogs": analogs,
        "excluded_malformed_structures": malformed_count,
        "search_provenance": {
            "source": adapter.source_name,
            "retrieved_at": retrieved_at,
            "cache_status": "refresh" if refresh else "fresh_lookup",
            "adapter_version": ADAPTER_VERSION,
            "source_query_threshold": getattr(adapter, "source_query_threshold", None),
            "source_query_threshold_role": "retrieval_parameter_not_scientific_cutoff",
            "max_analogs": max_analogs,
            "fingerprint": f"Morgan radius {MORGAN_RADIUS}, {MORGAN_FP_SIZE} bits",
            "similarity_metric": "Tanimoto calculated locally by MolOptima",
            "rdkit_version": rdkit.__version__,
        },
        "scientific_note": SCIENTIFIC_NOTE,
    }
    _write_cache(cache_path, params, result, retrieved_at)
    return result


def retrieve_experimental_records(
    source_compound_id: str, *, limit: int = 500, refresh: bool = False,
    adapter: KnownCompoundSource | None = None, cache_dir: Path | None = None,
) -> dict[str, Any]:
    """Retrieve and normalize one known compound's assay-level records without aggregation."""

    adapter = adapter or ChEMBLKnownCompoundSource()
    cache_root = cache_dir or KNOWN_ANALOG_CACHE_DIR
    params = {
        "source": adapter.source_name,
        "source_compound_id": source_compound_id,
        "query_type": "experimental_records",
        "limit": limit,
        "adapter_version": ADAPTER_VERSION,
    }
    cache_path = _cache_path(cache_root, "records", params)
    if not refresh:
        cached = _read_cache(cache_path)
        if cached is not None:
            result = dict(cached["result"])
            result["provenance"] = {
                **dict(result.get("provenance") or {}),
                "cache_status": "cache_hit",
                "cached_at": cached.get("retrieved_at"),
            }
            return result

    compound = adapter.fetch_compound(source_compound_id)
    payload = adapter.fetch_experimental_records(source_compound_id, limit)
    retrieved_at = utc_timestamp()
    records = [
        _normalize_experimental_record(item, compound, adapter.source_name, retrieved_at)
        for item in payload["activities"]
        if isinstance(item, dict)
    ]
    records = _annotate_compatibility(records)
    records.sort(key=lambda item: (
        str(dict(item.get("target") or {}).get("name") or ""),
        str(item.get("endpoint_name") or ""),
        str(item.get("assay_id") or ""),
        str(item.get("source_record_id") or ""),
    ))
    targets = sorted({str(record["target"].get("name") or record["target"].get("identifier") or "Unknown target") for record in records})
    endpoints = sorted({str(record.get("endpoint_name") or "Unknown endpoint") for record in records})
    result = {
        "contract_version": CONTRACT_VERSION,
        "compound": compound,
        "records": records,
        "returned_count": len(records),
        "source_total_count": payload["total_count"],
        "truncated": payload["total_count"] > len(records),
        "targets": targets,
        "endpoints": endpoints,
        "normalization_summary": {
            "normalized": sum(record["normalization"].get("status") == "normalized" for record in records),
            "not_converted": sum(record["normalization"].get("status") != "normalized" for record in records),
            "censored": sum(record.get("relation") in {"<", ">", "<=", ">="} for record in records),
        },
        "provenance": {
            "source": adapter.source_name,
            "source_compound_id": source_compound_id,
            "retrieved_at": retrieved_at,
            "cache_status": "refresh" if refresh else "fresh_lookup",
            "adapter_version": ADAPTER_VERSION,
            "record_limit": limit,
        },
        "scientific_note": SCIENTIFIC_NOTE,
    }
    _write_cache(cache_path, params, result, retrieved_at)
    return result


def _known_analog(
    source_item: dict[str, Any], query_smiles: str, query_fp: Any, *, exact_match: bool,
    adapter: KnownCompoundSource,
) -> dict[str, Any] | None:
    smiles = str(source_item.get("canonical_smiles") or "").strip()
    fingerprint = morgan_fingerprint(smiles)
    if fingerprint is None:
        return None
    similarity = float(DataStructs.TanimotoSimilarity(query_fp, fingerprint))
    return {
        "source": adapter.source_name,
        "source_compound_id": source_item["source_compound_id"],
        "preferred_name": source_item.get("preferred_name"),
        "canonical_smiles": smiles,
        "molecule_identity": canonical_identity_key(smiles),
        "exact_match": exact_match,
        "moloptima_tanimoto": round(similarity, 6),
        "same_murcko_scaffold": compare_murcko_scaffolds(query_smiles, smiles),
        "source_query_metadata": {
            "source_query_threshold": getattr(adapter, "source_query_threshold", None),
            "threshold_role": "retrieval_parameter_not_scientific_cutoff",
        },
        "experimental_record_count": None,
        "target_count": None,
        "counts_status": "available_after_record_retrieval",
        "provenance": {
            "source": adapter.source_name,
            "source_compound_id": source_item["source_compound_id"],
            "source_url": source_item.get("source_url"),
        },
    }


def _normalize_experimental_record(
    activity: dict[str, Any], compound: dict[str, Any], source: str, retrieved_at: str,
) -> dict[str, Any]:
    endpoint = str(activity.get("standard_type") or "").strip()
    unit = str(activity.get("standard_units") or "").strip()
    relation = str(activity.get("standard_relation") or "").strip()
    value = activity.get("standard_value")
    endpoint_for_normalization = endpoint
    if unit.lower() in {"%", "percent", "percentage"}:
        if endpoint.lower() == "inhibition":
            endpoint_for_normalization = "PERCENT_INHIBITION"
        elif endpoint.lower() == "activation":
            endpoint_for_normalization = "PERCENT_ACTIVATION"
    canonical = canonical_endpoint(endpoint_for_normalization)
    normalization = normalize_concentration(canonical, value, unit, relation)
    if unit.lower() in {"%", "percent", "percentage"}:
        normalization = {"status": "not_applicable", "reason": "percentage_endpoint_preserved"}
    source_record_id = str(activity.get("activity_id") or "").strip() or deterministic_identifier(
        "chembl-activity", compound["source_compound_id"], activity,
    )
    quality_flags = ["experimental_endpoint"]
    if relation in {"<", ">", "<=", ">="}:
        quality_flags.append("censored_value")
    if normalization.get("reason") == "unsupported_unit_conversion":
        quality_flags.append("unsupported_unit_conversion")
    target = {
        "identifier": str(activity.get("target_chembl_id") or "").strip(),
        "name": str(activity.get("target_pref_name") or "").strip(),
        "organism": str(activity.get("target_organism") or "").strip(),
        "construct_or_isoform": "",
    }
    return {
        "measurement_id": deterministic_identifier("public-experimental-measurement", source, source_record_id),
        "experimental": True,
        "source": source,
        "source_compound_id": compound["source_compound_id"],
        "source_record_id": source_record_id,
        "canonical_smiles": compound["canonical_smiles"],
        "endpoint_id": canonical,
        "endpoint_name": endpoint or canonical,
        "measurement_type": endpoint or canonical,
        "original_value": value,
        "original_unit": unit,
        "relation": relation,
        "normalization": normalization,
        "target": target,
        "assay_id": str(activity.get("assay_chembl_id") or "").strip(),
        "assay_protocol_version": "",
        "assay_type": str(activity.get("assay_type") or "").strip(),
        "assay_system": str(activity.get("bao_label") or "").strip(),
        "biological_mode": "",
        "readout": str(activity.get("assay_description") or "").strip(),
        "source_quality": {
            "pchembl_value": activity.get("pchembl_value"),
            "data_validity_comment": activity.get("data_validity_comment"),
            "activity_comment": activity.get("activity_comment"),
        },
        "publication_reference": str(activity.get("document_chembl_id") or "").strip(),
        "provenance": {
            "source": source,
            "external_compound_id": compound["source_compound_id"],
            "external_assay_id": str(activity.get("assay_chembl_id") or "").strip(),
            "external_record_id": source_record_id,
            "retrieved_at": retrieved_at,
            "publication_reference": str(activity.get("document_chembl_id") or "").strip(),
        },
        "quality_flags": quality_flags,
    }


def _annotate_compatibility(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    annotated = []
    for index, record in enumerate(records):
        target = dict(record.get("target") or {})
        target_id = str(target.get("identifier") or target.get("name") or "")
        endpoint = str(record.get("endpoint_id") or "")
        assay = str(record.get("assay_id") or "")
        protocol = str(record.get("assay_protocol_version") or "")
        organism = str(target.get("organism") or "")
        if not target_id or not endpoint or not assay or not organism:
            label = "Compatibility unclear"
        else:
            peers = [candidate for peer_index, candidate in enumerate(records) if peer_index != index]
            same_target = [candidate for candidate in peers if _target_key(candidate) == target_id]
            same_endpoint = [candidate for candidate in same_target if str(candidate.get("endpoint_id") or "") == endpoint]
            direct = [candidate for candidate in same_endpoint if (
                str(candidate.get("assay_id") or "") == assay
                and str(candidate.get("assay_protocol_version") or "") == protocol
                and str(dict(candidate.get("target") or {}).get("organism") or "") == organism
            )]
            if direct:
                label = "Directly comparable metadata"
            elif same_endpoint:
                label = "Different assay context"
            elif same_target:
                label = "Different endpoint"
            elif peers:
                label = "Different target"
            else:
                label = "Compatibility unclear"
        key = "|".join([target_id, endpoint, assay, protocol, organism])
        annotated.append({
            **record,
            "compatibility": {
                "label": label,
                "metadata_key": key,
                "basis": "descriptive record-level metadata; no assay harmonization",
            },
        })
    return annotated


def compare_murcko_scaffolds(query_smiles: str, candidate_smiles: str) -> str:
    query = _murcko_smiles(query_smiles)
    candidate = _murcko_smiles(candidate_smiles)
    if query is None or candidate is None:
        return "unavailable"
    if query == "" and candidate == "":
        return "No ring scaffold"
    if query == "" or candidate == "":
        return "No"
    return "Yes" if query == candidate else "No"


def _murcko_smiles(smiles: str) -> str | None:
    molecule = Chem.MolFromSmiles(smiles)
    if molecule is None:
        return None
    scaffold = MurckoScaffold.GetScaffoldForMol(molecule)
    if scaffold.GetNumAtoms() == 0:
        return ""
    Chem.RemoveStereochemistry(scaffold)
    return Chem.MolToSmiles(scaffold, canonical=True, isomericSmiles=False)


def _normalize_compound(payload: dict[str, Any]) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    molecule_id = str(payload.get("molecule_chembl_id") or "").strip()
    structures = payload.get("molecule_structures") or {}
    if not isinstance(structures, dict):
        return None
    smiles = str(structures.get("canonical_smiles") or "").strip()
    identity = canonical_identity_key(smiles)
    if not molecule_id or not identity:
        return None
    return {
        "source": "ChEMBL",
        "source_compound_id": molecule_id,
        "preferred_name": payload.get("pref_name"),
        "canonical_smiles": identity,
        "source_url": f"{CHEMBL_COMPOUND_URL}/{molecule_id}",
    }


def _dict_items(payload: dict[str, Any], key: str) -> list[dict[str, Any]]:
    values = payload.get(key, [])
    if not isinstance(values, list):
        raise KnownSourceError("malformed_source_response", f"ChEMBL response field '{key}' was malformed.")
    return [value for value in values if isinstance(value, dict)]


def _dedupe_compounds(compounds: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {}
    for compound in compounds:
        by_id.setdefault(compound["source_compound_id"], compound)
    return list(by_id.values())


def _target_key(record: dict[str, Any]) -> str:
    target = dict(record.get("target") or {})
    return str(target.get("identifier") or target.get("name") or "")


def _validate_chembl_id(value: str) -> None:
    if not value.startswith("CHEMBL") or not value[6:].isdigit():
        raise ValueError("A valid ChEMBL compound identifier is required.")


def _cache_path(cache_dir: Path, operation: str, params: dict[str, Any]) -> Path:
    encoded = json.dumps(params, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return cache_dir / ADAPTER_VERSION / operation / f"{digest}.json"


def _read_cache(path: Path) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        retrieved_at = datetime.fromisoformat(str(payload["retrieved_at"]))
        if datetime.now(timezone.utc) - retrieved_at > CACHE_TTL:
            return None
        if not isinstance(payload.get("result"), dict):
            return None
        return payload
    except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def _write_cache(path: Path, params: dict[str, Any], result: dict[str, Any], retrieved_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{uuid4().hex}.tmp")
    payload = {
        "adapter_version": ADAPTER_VERSION,
        "retrieved_at": retrieved_at,
        "expires_after_days": CACHE_TTL.days,
        "query": params,
        "result": result,
    }
    temporary.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(path)


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
