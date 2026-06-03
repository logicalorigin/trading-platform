from __future__ import annotations

import os

import uvicorn


def main() -> None:
    host = os.environ.get("PYRUS_IBKR_SIDECAR_HOST", "127.0.0.1")
    port = int(os.environ.get("PYRUS_IBKR_SIDECAR_PORT", "18769"))
    uvicorn.run(
        "pyrus_ibkr_sidecar.app:app",
        host=host,
        port=port,
        log_level=os.environ.get("PYRUS_IBKR_SIDECAR_LOG_LEVEL", "info"),
    )


if __name__ == "__main__":
    main()
