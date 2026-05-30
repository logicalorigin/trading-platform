from __future__ import annotations

import json

from .jobs import run_benchmark_matrix
from .models import BenchmarkMatrixInput


def main() -> None:
    result, warnings = run_benchmark_matrix(BenchmarkMatrixInput())
    print(json.dumps({"ok": True, "warnings": warnings, "result": result}, sort_keys=True))


if __name__ == "__main__":
    main()
