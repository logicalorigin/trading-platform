from __future__ import annotations

import json
import platform

import numpy as np
import polars as pl
import scipy  # type: ignore[import-untyped]

from . import __version__


def main() -> None:
    print(
        json.dumps(
            {
                "ok": True,
                "service": "pyrus-compute",
                "version": __version__,
                "python": platform.python_version(),
                "numpy": np.__version__,
                "scipy": scipy.__version__,
                "polars": pl.__version__,
            },
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
