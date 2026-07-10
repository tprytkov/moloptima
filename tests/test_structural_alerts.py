from molecular_prioritization import structural_alerts
from molecular_prioritization.structural_alerts import screen_structural_alerts


def test_valid_molecule_with_no_alerts():
    result = screen_structural_alerts("CCO", valid_molecule=True)

    assert result.structural_alert_status == "no_alerts"
    assert result.structural_alert_count == 0
    assert result.pains_alert is False
    assert result.brenk_alert is False
    assert "No PAINS or Brenk" in result.medchem_alert_summary


def test_molecule_with_known_alert_when_catalog_matches(monkeypatch):
    monkeypatch.setattr(
        structural_alerts,
        "_catalog_matches",
        lambda _mol, catalog_flag: ["fake_alert"] if "PAINS" in str(catalog_flag) else [],
    )

    result = screen_structural_alerts("CCO", valid_molecule=True)

    assert result.structural_alert_status == "alerts_detected"
    assert result.structural_alert_count == 1
    assert result.structural_alert_categories == "PAINS"
    assert result.structural_alert_names == "fake_alert"
    assert result.pains_alert is True
    assert result.brenk_alert is False


def test_invalid_molecule_skipped():
    result = screen_structural_alerts(None, valid_molecule=False)

    assert result.structural_alert_status == "not_run_invalid_molecule"
    assert result.structural_alert_count is None
    assert result.pains_alert is False
    assert result.brenk_alert is False


def test_alert_catalog_unavailable_handled_gracefully(monkeypatch):
    def unavailable(_mol, _catalog_flag):
        raise RuntimeError("catalog missing")

    monkeypatch.setattr(structural_alerts, "_catalog_matches", unavailable)

    result = screen_structural_alerts("CCO", valid_molecule=True)

    assert result.structural_alert_status == "alert_catalog_unavailable"
    assert result.structural_alert_count is None
    assert result.pains_alert is False
    assert "catalog missing" in result.medchem_alert_summary
