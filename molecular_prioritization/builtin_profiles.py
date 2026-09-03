"""Read-only discovery for bundled Prioritization v2 profile resources."""

from __future__ import annotations

import json
from pathlib import Path

from molecular_prioritization.prioritization_profiles import (
    PrioritizationProfile,
    profile_sha256,
)


BUILTIN_PROFILE_DIR = Path(__file__).resolve().parents[1] / "resources" / "prioritization_profiles"
CNS_LITERATURE_PROFILE_ID = "moloptima_cns_literature_v2"
CNS_LITERATURE_EVALUATED_VERSION = "0.1.0"
CNS_LITERATURE_EVALUATED_SHA256 = (
    "2405c68f2d9a37a40acd06d1fd2ea85aff1f0d2b442fe054b9d46b32dad405fc"
)
CNS_LITERATURE_PROFILE_VERSION = "1.0.0"
CNS_LITERATURE_DRAFT_NOTICE = (
    "Literature-informed draft profile. Scientific parameters have not yet been frozen."
)
CNS_LITERATURE_PROFILE_NOTICE = (
    "Frozen literature-informed CNS profile. Scientific parameters are read-only; "
    "create a custom profile to change them."
)
CNS_LITERATURE_EVALUATION_ARTIFACT = (
    "app_data/prioritization_analysis/alpha7_cns_profile_v0.1.0_evaluation_1"
)
CNS_LITERATURE_INTERPRETATION_NOTES = (
    "HIA predictions were concentrated at high model scores in the evaluated alpha7 library.",
    "Caco2 reached the favorable plateau for most candidates.",
    "BBB output was concentrated toward the high end.",
    "Predicted solubility was poor for a large portion of the library.",
    "Liability variation was the strongest realized rank discriminator.",
    "Configured equal component weights do not imply equal empirical influence in every chemical library.",
    "These observations were not used to retune the profile.",
)
GENERAL_SYSTEMIC_ORAL_PROFILE_ID = "moloptima_general_systemic_oral_v2"
GENERAL_SYSTEMIC_ORAL_DRAFT_VERSION = "0.1.0"
GENERAL_SYSTEMIC_ORAL_DRAFT_SHA256 = (
    "c265dbce0745112ed1b64d7264f51eb69382444c65972f52347561a6d4b1a435"
)
GENERAL_SYSTEMIC_ORAL_PROFILE_VERSION = "1.0.0"
PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID = "moloptima_peripheral_systemic_oral_v2"
PERIPHERAL_SYSTEMIC_ORAL_DRAFT_VERSION = "0.1.0"
PERIPHERAL_SYSTEMIC_ORAL_DRAFT_SHA256 = (
    "a8f3c8c394042789f41253695b7324464ebd968cb8727b8378d98056a2434c3e"
)
PERIPHERAL_SYSTEMIC_ORAL_PROFILE_VERSION = "1.0.0"
ORAL_SYSTEMIC_ROUTE_WARNING = (
    "These profiles assume oral systemic drug discovery. For IV, topical, inhaled, "
    "gut-restricted, or other target-product profiles, create a custom profile."
)
_PROFILE_PRESENTATION = {
    CNS_LITERATURE_PROFILE_ID: {
        "choice_label": "CNS Drug Discovery",
        "description": "Use when CNS penetration is desirable.",
        "route_warning": None,
    },
    GENERAL_SYSTEMIC_ORAL_PROFILE_ID: {
        "choice_label": "General Systemic Oral",
        "description": (
            "Use for oral systemic projects where CNS exposure is not a design objective."
        ),
        "route_warning": ORAL_SYSTEMIC_ROUTE_WARNING,
    },
    PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID: {
        "choice_label": "Peripheral Systemic Oral",
        "description": (
            "Use when oral systemic exposure is desired and CNS penetration should be limited."
        ),
        "route_warning": ORAL_SYSTEMIC_ROUTE_WARNING,
    },
}


def load_builtin_profiles() -> tuple[PrioritizationProfile, ...]:
    """Load every bundled JSON through the ordinary profile deserializer and validator."""

    profiles: list[PrioritizationProfile] = []
    for path in sorted(BUILTIN_PROFILE_DIR.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload, dict):
            raise ValueError(f"Built-in profile resource {path.name} must contain one object.")
        profile = PrioritizationProfile.from_dict(payload)
        profile.validate_for_scoring()
        profiles.append(profile)
    identities = [(profile.profile_id, profile.profile_version) for profile in profiles]
    if len(identities) != len(set(identities)):
        raise ValueError("Built-in profile ID/version pairs must be unique.")
    return tuple(profiles)


def builtin_profile_catalog() -> list[dict[str, object]]:
    """Return public-safe profile payloads and computed reproducibility metadata."""

    records = []
    for profile in load_builtin_profiles():
        current_versions = {
            CNS_LITERATURE_PROFILE_ID: CNS_LITERATURE_PROFILE_VERSION,
            GENERAL_SYSTEMIC_ORAL_PROFILE_ID: GENERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
            PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID: PERIPHERAL_SYSTEMIC_ORAL_PROFILE_VERSION,
        }
        is_current = profile.profile_version == current_versions.get(profile.profile_id)
        is_evaluated_draft = (
            profile.profile_id == CNS_LITERATURE_PROFILE_ID
            and profile.profile_version == CNS_LITERATURE_EVALUATED_VERSION
        )
        oral_draft_hashes = {
            GENERAL_SYSTEMIC_ORAL_PROFILE_ID: GENERAL_SYSTEMIC_ORAL_DRAFT_SHA256,
            PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID: PERIPHERAL_SYSTEMIC_ORAL_DRAFT_SHA256,
        }
        oral_draft_versions = {
            GENERAL_SYSTEMIC_ORAL_PROFILE_ID: GENERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
            PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID: PERIPHERAL_SYSTEMIC_ORAL_DRAFT_VERSION,
        }
        is_oral_draft = profile.profile_version == oral_draft_versions.get(profile.profile_id)
        is_historical = is_evaluated_draft or is_oral_draft
        is_current_oral = is_current and profile.profile_id in oral_draft_hashes
        presentation = _PROFILE_PRESENTATION.get(profile.profile_id, {})
        if profile.profile_id == GENERAL_SYSTEMIC_ORAL_PROFILE_ID:
            oral_interpretation_notes = [
                "Designed for oral systemic drug discovery.",
                "CNS penetration is neither rewarded nor penalized; BBB remains visible for interpretation.",
                "Not intended as a universal profile for all administration routes.",
                "Configuration was derived independently of alpha7 ranking.",
                "Draft v0.1.0 passed deterministic synthetic behavior tests; v1.0.0 freezes the same scientific configuration.",
                "Freezing does not imply biological or clinical validation.",
            ]
        elif profile.profile_id == PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID:
            oral_interpretation_notes = [
                "Designed for oral systemic projects where CNS exposure is undesirable.",
                "BBB-positive model output is a soft liability, not a hard exclusion criterion.",
                "The raw BBB model output is not quantitative brain exposure.",
                "Configuration was derived independently of alpha7 ranking.",
                "Draft v0.1.0 passed deterministic synthetic behavior tests; v1.0.0 freezes the same scientific configuration.",
                "Freezing does not imply biological or clinical validation.",
            ]
        else:
            oral_interpretation_notes = []
        records.append({
            "profile_id": profile.profile_id,
            "profile_version": profile.profile_version,
            "name": profile.name,
            "status": profile.status,
            "target_mode": profile.target_mode,
            "profile_sha256": profile_sha256(profile),
            "scoreable": True,
            "current": is_current,
            "recommended": is_current,
            "historical": is_historical,
            "read_only": profile.status == "frozen",
            "choice_label": presentation.get("choice_label", profile.name),
            "description": presentation.get(
                "description", "Built-in profile with explicit scientific configuration."
            ),
            "route_warning": presentation.get("route_warning"),
            "warnings": list(profile.validation_warnings()),
            "notice": (
                CNS_LITERATURE_PROFILE_NOTICE
                if is_current and profile.profile_id == CNS_LITERATURE_PROFILE_ID
                else (
                    "Frozen literature-informed oral systemic profile. Scientific parameters "
                    "are read-only; create a custom profile to change them."
                ) if is_current_oral
                else CNS_LITERATURE_DRAFT_NOTICE if is_evaluated_draft
                else (
                    "Historical literature-informed draft preserved for scientific reproducibility."
                ) if is_oral_draft
                else "Built-in profile loaded from a canonical project resource."
            ),
            "provenance": (
                {
                    "scientific_configuration_source_version": CNS_LITERATURE_EVALUATED_VERSION,
                    "scientific_configuration_source_sha256": CNS_LITERATURE_EVALUATED_SHA256,
                    "prospective_evaluation_candidate_count": 351,
                    "prospective_evaluation_status": "READY_FOR_SCIENTIFIC_REVIEW",
                    "prospective_evaluation_artifact": CNS_LITERATURE_EVALUATION_ARTIFACT,
                    "freeze_rationale": (
                        "The literature-informed profile was specified before inspecting the real "
                        "alpha7 candidate ranking. Draft v0.1.0 was prospectively evaluated on 351 "
                        "generated alpha7 molecules without a post-evaluation scientific parameter "
                        "change. No technical scoring defect, near-zero penalty collapse, or severe "
                        "score compression was detected. Version 1.0.0 freezes that same configuration."
                    ),
                    "validation_scope": (
                        "Prospective computational profile evaluation; not biological, clinical, "
                        "or external-dataset validation."
                    ),
                }
                if is_current and profile.profile_id == CNS_LITERATURE_PROFILE_ID else
                {
                    "preservation_role": "Exact profile used for prospective alpha7 evaluation reproducibility.",
                    "canonical_sha256": CNS_LITERATURE_EVALUATED_SHA256,
                    "prospective_evaluation_artifact": CNS_LITERATURE_EVALUATION_ARTIFACT,
                }
                if is_evaluated_draft else
                {
                    "scientific_configuration_source_version": oral_draft_versions[profile.profile_id],
                    "scientific_configuration_source_sha256": oral_draft_hashes[profile.profile_id],
                    "freeze_rationale": (
                        "Draft v0.1.0 passed deterministic synthetic target-aware behavior tests. "
                        "Version 1.0.0 freezes the identical scientific configuration, which was "
                        "derived independently of alpha7 ranking. Freezing is not biological or "
                        "clinical validation."
                    ),
                    "validation_scope": (
                        "Deterministic synthetic scientific-behavior testing; not biological, "
                        "clinical, or external-dataset validation."
                    ),
                }
                if is_current_oral else
                {
                    "preservation_role": (
                        "Exact draft configuration used for deterministic target-aware behavior tests."
                    ),
                    "canonical_sha256": oral_draft_hashes[profile.profile_id],
                }
                if is_oral_draft else {}
            ),
            "interpretation_notes": (
                list(CNS_LITERATURE_INTERPRETATION_NOTES)
                if is_current and profile.profile_id == CNS_LITERATURE_PROFILE_ID
                else oral_interpretation_notes if is_current_oral else []
            ),
            "profile": profile.to_dict(),
        })
    profile_order = {
        CNS_LITERATURE_PROFILE_ID: 0,
        GENERAL_SYSTEMIC_ORAL_PROFILE_ID: 1,
        PERIPHERAL_SYSTEMIC_ORAL_PROFILE_ID: 2,
    }
    records.sort(key=lambda record: (
        0 if bool(record["current"]) else 1,
        profile_order.get(str(record["profile_id"]), 99),
        str(record["profile_version"]),
    ))
    return records


def load_builtin_profile(profile_id: str, profile_version: str) -> PrioritizationProfile:
    """Resolve one exact built-in identity without introducing a scoring shortcut."""

    for profile in load_builtin_profiles():
        if profile.profile_id == profile_id and profile.profile_version == profile_version:
            return profile
    raise ValueError(f"Unknown built-in profile: {profile_id}@{profile_version}")
