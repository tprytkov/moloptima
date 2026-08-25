import copy
import hashlib
import importlib.util
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BRIDGE_PATH = (
    PROJECT_ROOT
    / "resources/admet/runners/chemprop_regression/v2/predict_chemprop_regression.py"
)


def _load_bridge_module():
    spec = importlib.util.spec_from_file_location("chemprop_regression_v2", BRIDGE_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class LegacyMetric:
    def __init__(self, n_tasks):
        self.n_tasks = n_tasks


class OtherMetric:
    pass


class FakeFactory:
    @classmethod
    def build(cls, metric_class, **values):
        return metric_class(n_tasks=values["n_tasks"])


class FakeMPNN:
    @classmethod
    def _rebuild_metric(cls, metric):
        if isinstance(metric, OtherMetric):
            raise ValueError("unrelated malformed metric")
        return ("original", metric)

    def load_state_dict(self, state_dict, *, strict):
        assert strict is True
        self.loaded_state = copy.deepcopy(state_dict)


def test_exact_legacy_metric_is_reconstructed_without_mutating_serialized_object():
    bridge = _load_bridge_module()
    metric = LegacyMetric(5)
    before = dict(metric.__dict__)
    with bridge.legacy_metric_cpu_loader_bridge(
        mpnn_class=FakeMPNN,
        factory=FakeFactory,
        legacy_metric_class=LegacyMetric,
    ):
        rebuilt = FakeMPNN._rebuild_metric(metric)
    assert isinstance(rebuilt, LegacyMetric)
    assert rebuilt is not metric
    assert rebuilt.n_tasks == 5
    assert metric.__dict__ == before
    assert not hasattr(metric, "task_weights")


def test_metric_that_already_has_task_weights_uses_original_chemprop_path():
    bridge = _load_bridge_module()
    metric = LegacyMetric(5)
    metric.task_weights = "serialized-value"
    with bridge.legacy_metric_cpu_loader_bridge(
        mpnn_class=FakeMPNN,
        factory=FakeFactory,
        legacy_metric_class=LegacyMetric,
    ):
        assert FakeMPNN._rebuild_metric(metric) == ("original", metric)
    assert metric.task_weights == "serialized-value"


def test_unrelated_malformed_metric_still_fails_closed():
    bridge = _load_bridge_module()
    with bridge.legacy_metric_cpu_loader_bridge(
        mpnn_class=FakeMPNN,
        factory=FakeFactory,
        legacy_metric_class=LegacyMetric,
    ):
        with pytest.raises(ValueError, match="unrelated malformed metric"):
            FakeMPNN._rebuild_metric(OtherMetric())


def test_original_chemprop_rebuilder_is_restored_after_context():
    bridge = _load_bridge_module()
    with bridge.legacy_metric_cpu_loader_bridge(
        mpnn_class=FakeMPNN,
        factory=FakeFactory,
        legacy_metric_class=LegacyMetric,
    ):
        assert isinstance(FakeMPNN._rebuild_metric(LegacyMetric(5)), LegacyMetric)
    assert FakeMPNN._rebuild_metric(LegacyMetric(5))[0] == "original"


def test_bridge_leaves_checkpoint_model_state_and_strict_loader_untouched():
    bridge = _load_bridge_module()
    checkpoint_bytes = b"synthetic-frozen-checkpoint"
    checkpoint_sha256 = hashlib.sha256(checkpoint_bytes).hexdigest()
    frozen_state = {"message_passing.weight": [[1.0, 2.0], [3.0, 4.0]]}
    frozen_state_before = copy.deepcopy(frozen_state)
    strict_loader = FakeMPNN.__dict__["load_state_dict"]
    model = FakeMPNN()

    with bridge.legacy_metric_cpu_loader_bridge(
        mpnn_class=FakeMPNN,
        factory=FakeFactory,
        legacy_metric_class=LegacyMetric,
    ):
        FakeMPNN._rebuild_metric(LegacyMetric(5))
        model.load_state_dict(frozen_state, strict=True)
        assert FakeMPNN.__dict__["load_state_dict"] is strict_loader

    assert hashlib.sha256(checkpoint_bytes).hexdigest() == checkpoint_sha256
    assert frozen_state == frozen_state_before
    assert model.loaded_state == frozen_state_before
    assert FakeMPNN.__dict__["load_state_dict"] is strict_loader
