from __future__ import annotations

import os
import time

from fastapi.testclient import TestClient

from pyrus_compute.app import JobStore, create_app


def test_health_and_capabilities() -> None:
    client = TestClient(create_app(JobStore(max_workers=1)))

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["ok"] is True

    capabilities = client.get("/capabilities")
    assert capabilities.status_code == 200
    assert {item["jobType"] for item in capabilities.json()["capabilities"]} == {
        "benchmark_matrix",
        "greek_scenario_matrix",
        "portfolio_optimization",
        "portfolio_risk",
        "signal_matrix",
    }


def test_lane_capabilities_filter_allowed_job_types() -> None:
    client = TestClient(
        create_app(
            JobStore(
                max_workers=1,
                lane="risk",
                allowed_job_types={"greek_scenario_matrix", "portfolio_risk"},
            )
        )
    )

    health = client.get("/health")
    assert health.status_code == 200
    assert health.json()["lane"] == "risk"

    capabilities = client.get("/capabilities")
    assert capabilities.status_code == 200
    assert {item["jobType"] for item in capabilities.json()["capabilities"]} == {
        "greek_scenario_matrix",
        "portfolio_risk",
    }

    rejected = client.post(
        "/jobs",
        json={
            "jobType": "portfolio_optimization",
            "schemaVersion": 1,
            "input": {"positions": []},
        },
    )
    assert rejected.status_code == 403
    assert rejected.json()["detail"] == "python_compute_job_type_not_allowed_for_lane"


def test_empty_lane_allowlist_rejects_all_jobs() -> None:
    client = TestClient(
        create_app(JobStore(max_workers=1, lane="backtest", allowed_job_types=set()))
    )

    capabilities = client.get("/capabilities")
    assert capabilities.status_code == 200
    assert capabilities.json()["capabilities"] == []

    rejected = client.post(
        "/jobs",
        json={
            "jobType": "portfolio_risk",
            "schemaVersion": 1,
            "input": {"positions": []},
        },
    )
    assert rejected.status_code == 403


def test_job_lifecycle() -> None:
    client = TestClient(create_app(JobStore(max_workers=1)))
    created = client.post(
        "/jobs",
        json={"jobType": "portfolio_risk", "schemaVersion": 1, "input": {"positions": []}},
    )
    assert created.status_code == 202
    job_id = created.json()["jobId"]

    for _ in range(30):
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        payload = response.json()
        if payload["status"] == "completed":
            break
        time.sleep(0.02)

    assert payload["status"] == "completed"
    assert payload["result"]["grossExposure"] == 0
    assert "portfolio_risk received no positions" in payload["warnings"]


def test_rejects_unknown_job_type() -> None:
    client = TestClient(create_app(JobStore(max_workers=1)))
    response = client.post("/jobs", json={"jobType": "unknown", "schemaVersion": 1, "input": {}})
    assert response.status_code == 422


def test_rejects_oversized_payload() -> None:
    previous = os.environ.get("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES")
    os.environ["PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES"] = "1024"
    try:
        client = TestClient(create_app(JobStore(max_workers=1)))
        response = client.post(
            "/jobs",
            json={
                "jobType": "benchmark_matrix",
                "schemaVersion": 1,
                "input": {"blob": "x" * 2_000},
            },
        )
    finally:
        if previous is None:
            os.environ.pop("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES", None)
        else:
            os.environ["PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES"] = previous

    assert response.status_code == 413
    assert response.json()["detail"] == "python_compute_payload_too_large"
