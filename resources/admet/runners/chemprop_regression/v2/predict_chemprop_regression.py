"""Versioned CPU loader bridge for the frozen Chemprop regression runner."""

from __future__ import annotations

import hashlib
import importlib.util
from contextlib import contextmanager
from pathlib import Path
from types import ModuleType
from typing import Iterator


COMPATIBILITY_VERSION = "equal-task-mean-standardized-mae-cpu-loader-v1"
BASE_RUNNER_SHA256 = "90923bb55caa7cde9a094ce235cea815520add2381bbd3d6159900be1e41674b"


def _load_verified_base_runner() -> ModuleType:
    path = Path(__file__).resolve().parents[1] / "v1" / "predict_chemprop_regression.py"
    if hashlib.sha256(path.read_bytes()).hexdigest() != BASE_RUNNER_SHA256:
        raise RuntimeError("The frozen Chemprop regression base runner failed verification.")
    spec = importlib.util.spec_from_file_location("moloptima_chemprop_regression_v1", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("The frozen Chemprop regression base runner cannot be loaded.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@contextmanager
def legacy_metric_cpu_loader_bridge(
    *,
    mpnn_class=None,
    factory=None,
    legacy_metric_class=None,
) -> Iterator[None]:
    """Rebuild only the exact GPU-tagged legacy metric without an unsupported argument."""

    if mpnn_class is None or factory is None or legacy_metric_class is None:
        from admet_platform.chemprop.losses import EqualTaskMeanStandardizedMAE
        from chemprop import models
        from chemprop.utils import Factory

        mpnn_class = models.MPNN
        factory = Factory
        legacy_metric_class = EqualTaskMeanStandardizedMAE

    original_descriptor = mpnn_class.__dict__["_rebuild_metric"]
    original_rebuild = mpnn_class._rebuild_metric

    def rebuild_metric(cls, metric):
        if metric.__class__ is legacy_metric_class and not hasattr(metric, "task_weights"):
            # The exact legacy constructor accepts only n_tasks. Chemprop's Factory filters
            # serialized state to that signature, so no task-weight value is invented.
            return factory.build(metric.__class__, **metric.__dict__)
        return original_rebuild(metric)

    mpnn_class._rebuild_metric = classmethod(rebuild_metric)
    try:
        yield
    finally:
        mpnn_class._rebuild_metric = original_descriptor


def main() -> None:
    base_runner = _load_verified_base_runner()
    with legacy_metric_cpu_loader_bridge():
        base_runner.main()


if __name__ == "__main__":
    main()
