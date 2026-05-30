from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("PYRUS_PYTHON_COMPUTE_HOST", "127.0.0.1")
    port = int(os.environ.get("PYRUS_PYTHON_COMPUTE_PORT", "18768"))
    uvicorn.run(
        "pyrus_compute.app:app",
        host=host,
        port=port,
        log_level=os.environ.get("PYRUS_PYTHON_COMPUTE_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
