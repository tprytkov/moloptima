#!/usr/bin/env python
"""Qualify real packaged GMC, regression, ChemBERTa, and optional Vina runtimes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


APPLICATION_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION_ROOT))

from molecular_prioritization.runtime_qualification import (  # noqa: E402
    PASS,
    QualificationConfig,
    run_qualification,
)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--application-root", type=Path, default=APPLICATION_ROOT)
    parser.add_argument("--receptor", type=Path)
    parser.add_argument("--center-x", type=float)
    parser.add_argument("--center-y", type=float)
    parser.add_argument("--center-z", type=float)
    parser.add_argument("--size-x", type=float)
    parser.add_argument("--size-y", type=float)
    parser.add_argument("--size-z", type=float)
    parser.add_argument("--exhaustiveness", type=int)
    parser.add_argument("--num-modes", type=int)
    parser.add_argument("--energy-range", type=float)
    parser.add_argument("--seed", type=int)
    parser.add_argument("--vina-executable", type=Path)
    parser.add_argument("--obabel-executable", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    summary = run_qualification(
        QualificationConfig(
            output_dir=args.output_dir,
            application_root=args.application_root,
            receptor=args.receptor,
            center_x=args.center_x,
            center_y=args.center_y,
            center_z=args.center_z,
            size_x=args.size_x,
            size_y=args.size_y,
            size_z=args.size_z,
            exhaustiveness=args.exhaustiveness,
            num_modes=args.num_modes,
            energy_range=args.energy_range,
            seed=args.seed,
            vina_executable=args.vina_executable,
            obabel_executable=args.obabel_executable,
        )
    )
    print(json.dumps({"overall_status": summary["overall_status"]}, sort_keys=True))
    return 0 if summary["overall_status"] == PASS else 2


if __name__ == "__main__":
    raise SystemExit(main())
