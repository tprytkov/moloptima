"""Optional public compound identity lookup with local caching."""

from __future__ import annotations

import hashlib
import json
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from biopharma_intelligence.identity import canonical_identity_key


PROJECT_ROOT = Path(__file__).resolve().parents[1]
PUBLIC_LOOKUP_CACHE_DIR = PROJECT_ROOT / "app_data" / "public_lookup_cache"
PUBCHEM_CACHE_DIR = PUBLIC_LOOKUP_CACHE_DIR / "pubchem"
CHEMBL_CACHE_DIR = PUBLIC_LOOKUP_CACHE_DIR / "chembl"
PUBCHEM_BASE_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug"
CHEMBL_BASE_URL = "https://www.ebi.ac.uk/chembl/api/data"


@dataclass(frozen=True)
class PublicIdentityResult:
    """Public exact-identity output fields."""

    pubchem_exact_match: bool
    pubchem_cid: str | None
    pubchem_preferred_name: str | None
    pubchem_lookup_status: str
    pubchem_cache_status: str
    pubchem_warning: str


@dataclass(frozen=True)
class ChEMBLBioactivityResult:
    """ChEMBL public bioactivity output fields."""

    chembl_exact_match: bool
    chembl_molecule_id: str | None
    chembl_pref_name: str | None
    chembl_lookup_status: str
    chembl_cache_status: str
    chembl_warning: str
    chembl_activity_count: int | None
    chembl_target_count: int | None
    chembl_target_summary: str | None
    chembl_similarity_match: bool
    chembl_similarity_score: float | None
    chembl_similarity_molecule_id: str | None
    chembl_similarity_pref_name: str | None
    chembl_similarity_status: str


def not_requested_result() -> PublicIdentityResult:
    return PublicIdentityResult(
        pubchem_exact_match=False,
        pubchem_cid=None,
        pubchem_preferred_name=None,
        pubchem_lookup_status="not_requested",
        pubchem_cache_status="not_used",
        pubchem_warning="Public lookup was not requested.",
    )


def chembl_not_requested_result() -> ChEMBLBioactivityResult:
    return ChEMBLBioactivityResult(
        chembl_exact_match=False,
        chembl_molecule_id=None,
        chembl_pref_name=None,
        chembl_lookup_status="not_requested",
        chembl_cache_status="not_used",
        chembl_warning="ChEMBL lookup was not requested.",
        chembl_activity_count=None,
        chembl_target_count=None,
        chembl_target_summary=None,
        chembl_similarity_match=False,
        chembl_similarity_score=None,
        chembl_similarity_molecule_id=None,
        chembl_similarity_pref_name=None,
        chembl_similarity_status="not_requested",
    )


def invalid_molecule_result() -> PublicIdentityResult:
    return PublicIdentityResult(
        pubchem_exact_match=False,
        pubchem_cid=None,
        pubchem_preferred_name=None,
        pubchem_lookup_status="not_run_invalid_molecule",
        pubchem_cache_status="not_used",
        pubchem_warning="Public lookup skipped for invalid molecule.",
    )


def chembl_invalid_molecule_result() -> ChEMBLBioactivityResult:
    return ChEMBLBioactivityResult(
        chembl_exact_match=False,
        chembl_molecule_id=None,
        chembl_pref_name=None,
        chembl_lookup_status="not_run_invalid_molecule",
        chembl_cache_status="not_used",
        chembl_warning="ChEMBL lookup skipped for invalid molecule.",
        chembl_activity_count=None,
        chembl_target_count=None,
        chembl_target_summary=None,
        chembl_similarity_match=False,
        chembl_similarity_score=None,
        chembl_similarity_molecule_id=None,
        chembl_similarity_pref_name=None,
        chembl_similarity_status="not_run_invalid_molecule",
    )


class PubChemClient:
    """Small PubChem PUG REST client used only when public lookup is enabled."""

    def __init__(
        self,
        *,
        cache_dir: Path | None = None,
        timeout_seconds: float = 10.0,
        base_url: str = PUBCHEM_BASE_URL,
    ) -> None:
        self.cache_dir = cache_dir or PUBCHEM_CACHE_DIR
        self.timeout_seconds = timeout_seconds
        self.base_url = base_url.rstrip("/")

    def lookup_exact_identity(
        self,
        canonical_smiles: str | None,
        valid_molecule: bool,
    ) -> PublicIdentityResult:
        """Return a cached or fresh PubChem exact-identity result."""

        if not valid_molecule or not canonical_smiles:
            return invalid_molecule_result()

        identity_key = canonical_identity_key(canonical_smiles)
        if identity_key is None:
            return invalid_molecule_result()

        cached_payload = self._read_cache(identity_key)
        if cached_payload is not None:
            result = self._result_from_payload(cached_payload)
            return PublicIdentityResult(
                **{
                    **asdict(result),
                    "pubchem_cache_status": "cache_hit",
                }
            )

        try:
            result = self._fetch_pubchem_result(identity_key)
        except Exception as exc:
            result = PublicIdentityResult(
                pubchem_exact_match=False,
                pubchem_cid=None,
                pubchem_preferred_name=None,
                pubchem_lookup_status="lookup_failed",
                pubchem_cache_status="cache_miss",
                pubchem_warning=str(exc),
            )

        self._write_cache(identity_key, result)
        return result

    def _fetch_pubchem_result(self, identity_key: str) -> PublicIdentityResult:
        encoded_smiles = urllib.parse.quote(identity_key, safe="")
        cid_url = f"{self.base_url}/compound/smiles/{encoded_smiles}/cids/JSON"
        cid_payload = self._get_json(cid_url)
        cids = cid_payload.get("IdentifierList", {}).get("CID", [])

        if not cids:
            return PublicIdentityResult(
                pubchem_exact_match=False,
                pubchem_cid=None,
                pubchem_preferred_name=None,
                pubchem_lookup_status="no_exact_match",
                pubchem_cache_status="fresh_lookup",
                pubchem_warning="",
            )

        cid = str(cids[0])
        preferred_name = self._fetch_preferred_name(cid)
        return PublicIdentityResult(
            pubchem_exact_match=True,
            pubchem_cid=cid,
            pubchem_preferred_name=preferred_name,
            pubchem_lookup_status="exact_match",
            pubchem_cache_status="fresh_lookup",
            pubchem_warning="",
        )

    def _fetch_preferred_name(self, cid: str) -> str | None:
        property_url = f"{self.base_url}/compound/cid/{urllib.parse.quote(cid)}/property/Title,IUPACName/JSON"
        try:
            payload = self._get_json(property_url)
        except Exception:
            return None

        properties = payload.get("PropertyTable", {}).get("Properties", [])
        if not properties:
            return None
        first_property = properties[0]
        return first_property.get("Title") or first_property.get("IUPACName")

    def _get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": "MolOptima/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            raise RuntimeError(f"PubChem lookup failed with HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"PubChem lookup unavailable: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("PubChem returned invalid JSON.") from exc

    def _cache_path(self, identity_key: str) -> Path:
        digest = hashlib.sha256(identity_key.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _read_cache(self, identity_key: str) -> dict[str, Any] | None:
        cache_path = self._cache_path(identity_key)
        if not cache_path.exists():
            return None
        try:
            with cache_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    def _write_cache(self, identity_key: str, result: PublicIdentityResult) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "PubChem",
            "identity_key": identity_key,
            "cached_at": utc_timestamp(),
            "result": asdict(result),
        }
        with self._cache_path(identity_key).open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")

    def _result_from_payload(self, payload: dict[str, Any]) -> PublicIdentityResult:
        result = payload.get("result")
        if not isinstance(result, dict):
            return PublicIdentityResult(
                pubchem_exact_match=False,
                pubchem_cid=None,
                pubchem_preferred_name=None,
                pubchem_lookup_status="lookup_failed",
                pubchem_cache_status="cache_hit",
                pubchem_warning="Cached PubChem payload was malformed.",
            )
        return PublicIdentityResult(
            pubchem_exact_match=bool(result.get("pubchem_exact_match")),
            pubchem_cid=result.get("pubchem_cid"),
            pubchem_preferred_name=result.get("pubchem_preferred_name"),
            pubchem_lookup_status=str(result.get("pubchem_lookup_status") or "lookup_failed"),
            pubchem_cache_status=str(result.get("pubchem_cache_status") or "cache_hit"),
            pubchem_warning=str(result.get("pubchem_warning") or ""),
        )


class ChEMBLClient:
    """Small ChEMBL web services client used only when ChEMBL lookup is enabled."""

    def __init__(
        self,
        *,
        cache_dir: Path | None = None,
        timeout_seconds: float = 10.0,
        base_url: str = CHEMBL_BASE_URL,
        similarity_cutoff: int = 85,
    ) -> None:
        self.cache_dir = cache_dir or CHEMBL_CACHE_DIR
        self.timeout_seconds = timeout_seconds
        self.base_url = base_url.rstrip("/")
        self.similarity_cutoff = similarity_cutoff

    def lookup_bioactivity_context(
        self,
        canonical_smiles: str | None,
        valid_molecule: bool,
    ) -> ChEMBLBioactivityResult:
        """Return cached or fresh ChEMBL molecule and bioactivity context."""

        if not valid_molecule or not canonical_smiles:
            return chembl_invalid_molecule_result()

        identity_key = canonical_identity_key(canonical_smiles)
        if identity_key is None:
            return chembl_invalid_molecule_result()

        cached_payload = self._read_cache(identity_key)
        if cached_payload is not None:
            result = self._result_from_payload(cached_payload)
            return ChEMBLBioactivityResult(
                **{
                    **asdict(result),
                    "chembl_cache_status": "cache_hit",
                }
            )

        try:
            result = self._fetch_chembl_result(identity_key)
        except Exception as exc:
            result = ChEMBLBioactivityResult(
                chembl_exact_match=False,
                chembl_molecule_id=None,
                chembl_pref_name=None,
                chembl_lookup_status="lookup_failed",
                chembl_cache_status="cache_miss",
                chembl_warning=str(exc),
                chembl_activity_count=None,
                chembl_target_count=None,
                chembl_target_summary=None,
                chembl_similarity_match=False,
                chembl_similarity_score=None,
                chembl_similarity_molecule_id=None,
                chembl_similarity_pref_name=None,
                chembl_similarity_status="lookup_failed",
            )

        self._write_cache(identity_key, result)
        return result

    def _fetch_chembl_result(self, identity_key: str) -> ChEMBLBioactivityResult:
        molecule = self._fetch_exact_molecule(identity_key)
        if molecule is not None:
            molecule_id = molecule.get("molecule_chembl_id")
            summary = self._fetch_activity_summary(str(molecule_id))
            return ChEMBLBioactivityResult(
                chembl_exact_match=True,
                chembl_molecule_id=str(molecule_id),
                chembl_pref_name=molecule.get("pref_name"),
                chembl_lookup_status="exact_match",
                chembl_cache_status="fresh_lookup",
                chembl_warning="",
                chembl_activity_count=summary["activity_count"],
                chembl_target_count=summary["target_count"],
                chembl_target_summary=summary["target_summary"],
                chembl_similarity_match=False,
                chembl_similarity_score=None,
                chembl_similarity_molecule_id=None,
                chembl_similarity_pref_name=None,
                chembl_similarity_status="not_run_exact_match_found",
            )

        similar_molecule = self._fetch_similarity_molecule(identity_key)
        if similar_molecule is None:
            return ChEMBLBioactivityResult(
                chembl_exact_match=False,
                chembl_molecule_id=None,
                chembl_pref_name=None,
                chembl_lookup_status="no_match",
                chembl_cache_status="fresh_lookup",
                chembl_warning="",
                chembl_activity_count=0,
                chembl_target_count=0,
                chembl_target_summary=None,
                chembl_similarity_match=False,
                chembl_similarity_score=None,
                chembl_similarity_molecule_id=None,
                chembl_similarity_pref_name=None,
                chembl_similarity_status="no_match",
            )

        molecule_id = str(similar_molecule.get("molecule_chembl_id"))
        summary = self._fetch_activity_summary(molecule_id)
        return ChEMBLBioactivityResult(
            chembl_exact_match=False,
            chembl_molecule_id=None,
            chembl_pref_name=None,
            chembl_lookup_status="similarity_match",
            chembl_cache_status="fresh_lookup",
            chembl_warning="",
            chembl_activity_count=summary["activity_count"],
            chembl_target_count=summary["target_count"],
            chembl_target_summary=summary["target_summary"],
            chembl_similarity_match=True,
            chembl_similarity_score=self._parse_similarity_score(similar_molecule),
            chembl_similarity_molecule_id=molecule_id,
            chembl_similarity_pref_name=similar_molecule.get("pref_name"),
            chembl_similarity_status="similarity_match",
        )

    def _fetch_exact_molecule(self, identity_key: str) -> dict[str, Any] | None:
        url = (
            f"{self.base_url}/molecule.json?"
            f"molecule_structures__canonical_smiles__flexmatch={urllib.parse.quote(identity_key, safe='')}"
            "&limit=1"
        )
        payload = self._get_json(url)
        molecules = payload.get("molecules", [])
        return molecules[0] if molecules else None

    def _fetch_similarity_molecule(self, identity_key: str) -> dict[str, Any] | None:
        url = (
            f"{self.base_url}/similarity/"
            f"{urllib.parse.quote(identity_key, safe='')}/{self.similarity_cutoff}.json?limit=1"
        )
        payload = self._get_json(url)
        molecules = payload.get("molecules", [])
        return molecules[0] if molecules else None

    def _fetch_activity_summary(self, molecule_id: str) -> dict[str, int | str | None]:
        url = (
            f"{self.base_url}/activity.json?"
            f"molecule_chembl_id={urllib.parse.quote(molecule_id, safe='')}"
            "&limit=100&only=target_chembl_id,target_pref_name"
        )
        payload = self._get_json(url)
        activities = payload.get("activities", [])
        targets = sorted(
            {
                str(activity.get("target_pref_name", "")).strip()
                for activity in activities
                if str(activity.get("target_pref_name", "")).strip()
            }
        )
        return {
            "activity_count": int(payload.get("page_meta", {}).get("total_count", len(activities)) or 0),
            "target_count": len(targets),
            "target_summary": "; ".join(targets[:5]) if targets else None,
        }

    def _parse_similarity_score(self, molecule: dict[str, Any]) -> float | None:
        similarity = molecule.get("similarity")
        if similarity is None:
            return None
        try:
            return round(float(similarity), 3)
        except (TypeError, ValueError):
            return None

    def _get_json(self, url: str) -> dict[str, Any]:
        request = urllib.request.Request(url, headers={"User-Agent": "MolOptima/0.1"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code == 404:
                return {}
            raise RuntimeError(f"ChEMBL lookup failed with HTTP {exc.code}.") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"ChEMBL lookup unavailable: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise RuntimeError("ChEMBL returned invalid JSON.") from exc

    def _cache_path(self, identity_key: str) -> Path:
        digest = hashlib.sha256(identity_key.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def _read_cache(self, identity_key: str) -> dict[str, Any] | None:
        cache_path = self._cache_path(identity_key)
        if not cache_path.exists():
            return None
        try:
            with cache_path.open("r", encoding="utf-8") as handle:
                payload = json.load(handle)
        except Exception:
            return None
        return payload if isinstance(payload, dict) else None

    def _write_cache(self, identity_key: str, result: ChEMBLBioactivityResult) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "source": "ChEMBL",
            "identity_key": identity_key,
            "cached_at": utc_timestamp(),
            "result": asdict(result),
        }
        with self._cache_path(identity_key).open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")

    def _result_from_payload(self, payload: dict[str, Any]) -> ChEMBLBioactivityResult:
        result = payload.get("result")
        if not isinstance(result, dict):
            return ChEMBLBioactivityResult(
                chembl_exact_match=False,
                chembl_molecule_id=None,
                chembl_pref_name=None,
                chembl_lookup_status="lookup_failed",
                chembl_cache_status="cache_hit",
                chembl_warning="Cached ChEMBL payload was malformed.",
                chembl_activity_count=None,
                chembl_target_count=None,
                chembl_target_summary=None,
                chembl_similarity_match=False,
                chembl_similarity_score=None,
                chembl_similarity_molecule_id=None,
                chembl_similarity_pref_name=None,
                chembl_similarity_status="lookup_failed",
            )
        return ChEMBLBioactivityResult(
            chembl_exact_match=bool(result.get("chembl_exact_match")),
            chembl_molecule_id=result.get("chembl_molecule_id"),
            chembl_pref_name=result.get("chembl_pref_name"),
            chembl_lookup_status=str(result.get("chembl_lookup_status") or "lookup_failed"),
            chembl_cache_status=str(result.get("chembl_cache_status") or "cache_hit"),
            chembl_warning=str(result.get("chembl_warning") or ""),
            chembl_activity_count=result.get("chembl_activity_count"),
            chembl_target_count=result.get("chembl_target_count"),
            chembl_target_summary=result.get("chembl_target_summary"),
            chembl_similarity_match=bool(result.get("chembl_similarity_match")),
            chembl_similarity_score=result.get("chembl_similarity_score"),
            chembl_similarity_molecule_id=result.get("chembl_similarity_molecule_id"),
            chembl_similarity_pref_name=result.get("chembl_similarity_pref_name"),
            chembl_similarity_status=str(result.get("chembl_similarity_status") or "not_requested"),
        )


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()
