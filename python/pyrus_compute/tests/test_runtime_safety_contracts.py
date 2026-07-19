import asyncio
import math
import threading
from datetime import UTC, datetime, timedelta

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

import pyrus_compute.app as app_module
from pyrus_compute.app import JobStore, PayloadLimitMiddleware, StoredJob, create_app
from pyrus_compute.models import (
    GreekScenarioMatrixInput,
    JobRequest,
    JobResult,
    JobStatus,
    JobType,
    PortfolioRiskInput,
    _ensure_finite_numbers,
)


def _request(*, timeout_ms: int = 30_000) -> JobRequest:
    return JobRequest(
        jobType=JobType.BENCHMARK_MATRIX,
        input={"rows": 100, "trials": 1, "seed": 1},
        options={"timeoutMs": timeout_ms},
    )


async def _asgi_post_without_content_length(body: bytes) -> int:
    app = create_app(JobStore(max_workers=1))
    chunks = [body[:600], body[600:]]
    sent: list[dict] = []

    async def receive() -> dict:
        chunk = chunks.pop(0)
        return {
            "type": "http.request",
            "body": chunk,
            "more_body": bool(chunks),
        }

    async def send(message: dict) -> None:
        sent.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/capabilities",
            "raw_path": b"/capabilities",
            "query_string": b"",
            "headers": [(b"content-type", b"application/json")],
            "client": ("test", 1),
            "server": ("test", 80),
        },
        receive,
        send,
    )
    return next(message["status"] for message in sent if message["type"] == "http.response.start")


def test_streamed_payload_over_limit_is_rejected_without_content_length(monkeypatch) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES", "1024")

    status = asyncio.run(_asgi_post_without_content_length(b"x" * 1_025))

    assert status == 413


async def _exercise_payload_middleware(
    messages: list[dict],
    *,
    headers: list[tuple[bytes, bytes]] | None = None,
) -> tuple[list[dict], int]:
    delivered: list[dict] = []
    sent: list[dict] = []

    async def downstream(_scope, receive, send) -> None:
        while True:
            message = await receive()
            delivered.append(message)
            if message["type"] == "http.disconnect" or not message.get("more_body", False):
                break
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    async def receive() -> dict:
        return messages.pop(0)

    async def send(message: dict) -> None:
        sent.append(message)

    await PayloadLimitMiddleware(downstream)(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "POST",
            "scheme": "http",
            "path": "/",
            "raw_path": b"/",
            "query_string": b"",
            "headers": headers or [],
            "client": ("test", 1),
            "server": ("test", 80),
        },
        receive,
        send,
    )
    status = next(message["status"] for message in sent if message["type"] == "http.response.start")
    return delivered, status


def test_payload_middleware_coalesces_fragmented_body_before_routing() -> None:
    fragments = [
        {
            "type": "http.request",
            "body": b"x",
            "more_body": index < 999,
        }
        for index in range(1_000)
    ]

    delivered, status = asyncio.run(_exercise_payload_middleware(fragments))

    assert status == 204
    assert delivered == [
        {
            "type": "http.request",
            "body": b"x" * 1_000,
            "more_body": False,
        }
    ]


def test_payload_middleware_bounds_empty_fragment_count(monkeypatch) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES", "1024")
    fragments = [
        {
            "type": "http.request",
            "body": b"",
            "more_body": index < 4_096,
        }
        for index in range(4_097)
    ]

    delivered, status = asyncio.run(_exercise_payload_middleware(fragments))

    assert status == 413
    assert delivered == []


def test_payload_middleware_enforces_body_limit_when_content_length_headers_lie(
    monkeypatch,
) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES", "1024")

    delivered, status = asyncio.run(
        _exercise_payload_middleware(
            [
                {
                    "type": "http.request",
                    "body": b"x" * 1_025,
                    "more_body": False,
                }
            ],
            headers=[
                (b"content-length", b"0"),
                (b"content-length", b"1"),
            ],
        )
    )

    assert status == 413
    assert delivered == []


def test_payload_middleware_preserves_disconnect_after_partial_body() -> None:
    delivered, status = asyncio.run(
        _exercise_payload_middleware(
            [
                {"type": "http.request", "body": b"partial", "more_body": True},
                {"type": "http.disconnect"},
            ],
            headers=[(b"content-length", b"0")],
        )
    )

    assert status == 204
    assert delivered == [
        {"type": "http.request", "body": b"partial", "more_body": True},
        {"type": "http.disconnect"},
    ]


@pytest.mark.parametrize("value", [math.nan, math.inf, -math.inf], ids=["nan", "inf", "neg-inf"])
def test_job_request_rejects_non_finite_input_tree(value: float) -> None:
    with pytest.raises(ValidationError):
        JobRequest.model_validate(
            {
                "jobType": "portfolio_risk",
                "schemaVersion": 1,
                "input": {
                    "positions": [{"symbol": "SPY", "quantity": value, "price": 100}],
                },
            }
        )


@pytest.mark.parametrize(
    "value",
    ["NaN", "Infinity", "-Infinity"],
    ids=["nan-string", "inf-string", "neg-inf-string"],
)
def test_typed_job_input_rejects_coerced_non_finite_numeric_string(value: str) -> None:
    with pytest.raises(ValidationError):
        PortfolioRiskInput.model_validate(
            {
                "positions": [
                    {"symbol": "SPY", "quantity": value, "price": 100},
                ],
            }
        )


def test_finite_huge_integer_is_rejected_by_typed_model_not_numeric_tree_walker() -> None:
    _ensure_finite_numbers({"quantity": 10**309}, "input")
    with pytest.raises(ValidationError):
        PortfolioRiskInput.model_validate(
            {
                "positions": [
                    {"symbol": "SPY", "quantity": 10**309, "price": 100},
                ],
            }
        )


def test_numeric_tree_walker_rejects_excessive_depth_without_recursion_error() -> None:
    value: dict = {}
    cursor = value
    for _ in range(101):
        child: dict = {}
        cursor["nested"] = child
        cursor = child

    with pytest.raises(ValueError, match="depth"):
        _ensure_finite_numbers(value, "input")


def test_finite_request_with_non_finite_result_is_not_completed() -> None:
    async def exercise() -> None:
        store = JobStore(max_workers=1)
        try:
            accepted = await store.submit(
                JobRequest(
                    jobType=JobType.PORTFOLIO_RISK,
                    input={"positions": [{"symbol": "SPY", "quantity": 1e308, "price": 1e308}]},
                )
            )
            task = store._jobs[accepted.jobId].task
            assert task is not None
            await task

            result = store.get(accepted.jobId)
            assert result.status == JobStatus.FAILED
            assert result.result is None
        finally:
            store._executor.shutdown(wait=True)

    asyncio.run(exercise())


def test_failed_job_does_not_retain_or_return_raw_exception_message(monkeypatch) -> None:
    hostile_message = "\x1b[31msecret-token=do-not-return\n/internal/path\x1b[0m"

    def fail_job(_request: JobRequest) -> tuple[dict, list[str]]:
        raise RuntimeError(hostile_message)

    monkeypatch.setattr(app_module, "run_job", fail_job)

    async def exercise() -> None:
        store = JobStore(max_workers=1)
        try:
            accepted = await store.submit(_request())
            task = store._jobs[accepted.jobId].task
            assert task is not None
            await task

            result = store.get(accepted.jobId)
            assert result.status == JobStatus.FAILED
            assert result.error == {
                "code": "python_compute_job_failed",
                "message": "Job failed.",
            }
        finally:
            store._executor.shutdown(wait=True)

    asyncio.run(exercise())


def test_greek_scenario_matrix_rejects_combinatorial_work_above_budget() -> None:
    position = {"symbol": "SPY-C", "underlying": "SPY", "spot": 100}

    with pytest.raises(ValidationError):
        GreekScenarioMatrixInput.model_validate(
            {
                "positions": [position] * 5_000,
                "spotShocks": [0.0] * 51,
                "ivShocks": [0.0] * 31,
                "dayOffsets": [0.0] * 31,
            }
        )


@pytest.mark.parametrize("termination", ["cancel", "timeout"])
def test_executor_occupancy_remains_reported_until_calculation_exits(
    monkeypatch,
    termination: str,
) -> None:
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()

    def blocking_job(_request: JobRequest) -> tuple[dict, list[str]]:
        started.set()
        try:
            release.wait()
        finally:
            finished.set()
        return {}, []

    monkeypatch.setattr(app_module, "run_job", blocking_job)
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_MAX_JOBS", "1")

    async def exercise() -> None:
        store = JobStore(max_workers=1)
        try:
            accepted = await store.submit(
                _request(timeout_ms=100 if termination == "timeout" else 30_000)
            )
            task = store._jobs[accepted.jobId].task
            assert task is not None
            assert await asyncio.to_thread(started.wait, 1)

            if termination == "cancel":
                store.cancel(accepted.jobId)
                with pytest.raises(asyncio.CancelledError):
                    await task
            else:
                await task
                assert store.get(accepted.jobId).error == {
                    "code": "python_compute_job_timeout",
                    "message": "Job timed out.",
                }

            with pytest.raises(HTTPException) as rejected:
                await store.submit(_request())
            assert rejected.value.status_code == 429
            assert store.active_jobs == 1
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 1)
            await asyncio.sleep(0)
            store._executor.shutdown(wait=True)

    asyncio.run(exercise())


def test_terminal_job_retention_expires_ancient_completed_record() -> None:
    store = JobStore(max_workers=1)
    try:
        store._jobs["expired"] = StoredJob(
            request=_request(),
            result=JobResult(
                jobId="expired",
                jobType=JobType.BENCHMARK_MATRIX,
                status=JobStatus.COMPLETED,
                createdAt="2000-01-01T00:00:00+00:00",
                completedAt="2000-01-01T00:00:01+00:00",
                result={},
            ),
        )

        store._prune_terminal_jobs()

        with pytest.raises(HTTPException) as missing:
            store.get("expired")
        assert missing.value.status_code == 404
    finally:
        store._executor.shutdown(wait=True)


def test_terminal_job_retention_is_enforced_by_read_without_other_mutation() -> None:
    store = JobStore(max_workers=1)
    try:
        store._jobs["expired"] = StoredJob(
            request=None,
            result=JobResult(
                jobId="expired",
                jobType=JobType.BENCHMARK_MATRIX,
                status=JobStatus.COMPLETED,
                createdAt="2000-01-01T00:00:00+00:00",
                completedAt="2000-01-01T00:00:01+00:00",
                result={},
            ),
        )

        with pytest.raises(HTTPException) as missing:
            store.get("expired")
        assert missing.value.status_code == 404
    finally:
        store._executor.shutdown(wait=True)


def test_terminal_job_retention_is_enforced_by_cancel_without_other_mutation() -> None:
    store = JobStore(max_workers=1)
    try:
        store._jobs["expired"] = StoredJob(
            request=None,
            result=JobResult(
                jobId="expired",
                jobType=JobType.BENCHMARK_MATRIX,
                status=JobStatus.COMPLETED,
                createdAt="2000-01-01T00:00:00+00:00",
                completedAt="2000-01-01T00:00:01+00:00",
                result={},
            ),
        )

        with pytest.raises(HTTPException) as missing:
            store.cancel("expired")
        assert missing.value.status_code == 404
        assert "expired" not in store._jobs
    finally:
        store._executor.shutdown(wait=True)


def test_terminal_job_limit_evicts_by_completion_time_not_submission_order() -> None:
    store = JobStore(max_workers=1)
    now = datetime.now(UTC)
    try:
        store._jobs["recent-long-running"] = StoredJob(
            request=None,
            result=JobResult(
                jobId="recent-long-running",
                jobType=JobType.BENCHMARK_MATRIX,
                status=JobStatus.COMPLETED,
                createdAt=(now - timedelta(minutes=59)).isoformat(),
                completedAt=now.isoformat(),
                result={},
            ),
        )
        for index in range(200):
            job_id = f"older-{index:03d}"
            store._jobs[job_id] = StoredJob(
                request=None,
                result=JobResult(
                    jobId=job_id,
                    jobType=JobType.BENCHMARK_MATRIX,
                    status=JobStatus.COMPLETED,
                    createdAt=(now - timedelta(minutes=45)).isoformat(),
                    completedAt=(
                        now - timedelta(minutes=30) + timedelta(seconds=index)
                    ).isoformat(),
                    result={},
                ),
            )

        store._prune_terminal_jobs()

        assert "recent-long-running" in store._jobs
        assert "older-000" not in store._jobs
        assert len(store._jobs) == 200
    finally:
        store._executor.shutdown(wait=True)


def test_terminal_job_retention_evicts_oldest_results_until_byte_budget_fits(
    monkeypatch,
) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_TERMINAL_RETENTION_BYTES", "1200")
    store = JobStore(max_workers=1)
    now = datetime.now(UTC)
    try:
        for job_id, completed_at in [
            ("older", now - timedelta(minutes=2)),
            ("newer", now - timedelta(minutes=1)),
        ]:
            result = JobResult(
                jobId=job_id,
                jobType=JobType.BENCHMARK_MATRIX,
                status=JobStatus.COMPLETED,
                createdAt=(now - timedelta(minutes=3)).isoformat(),
                completedAt=completed_at.isoformat(),
                result={"blob": "x" * 700},
            )
            assert len(result.model_dump_json().encode("utf-8")) < 1_200
            store._jobs[job_id] = StoredJob(request=None, result=result)

        store._prune_terminal_jobs()

        assert set(store._jobs) == {"newer"}
    finally:
        store._executor.shutdown(wait=True)


def test_terminal_job_retention_budget_allows_values_above_default(monkeypatch) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_TERMINAL_RETENTION_BYTES", "250000000")

    assert app_module.terminal_job_retention_bytes() == 250_000_000


def test_terminal_job_retention_discards_unserializable_result_without_evicting_valid(
    monkeypatch,
) -> None:
    monkeypatch.setenv("PYRUS_PYTHON_COMPUTE_TERMINAL_RETENTION_BYTES", "1200")
    store = JobStore(max_workers=1)
    now = datetime.now(UTC)
    try:
        older = JobResult(
            jobId="older-valid",
            jobType=JobType.BENCHMARK_MATRIX,
            status=JobStatus.COMPLETED,
            createdAt=(now - timedelta(minutes=3)).isoformat(),
            completedAt=(now - timedelta(minutes=2)).isoformat(),
            result={"ok": True},
        )
        newer = JobResult(
            jobId="newer-unserializable",
            jobType=JobType.BENCHMARK_MATRIX,
            status=JobStatus.COMPLETED,
            createdAt=(now - timedelta(minutes=2)).isoformat(),
            completedAt=(now - timedelta(minutes=1)).isoformat(),
            result={"value": object()},
        )
        with pytest.raises(ValueError):
            newer.model_dump_json()
        store._jobs["older-valid"] = StoredJob(request=None, result=older)
        store._jobs["newer-unserializable"] = StoredJob(request=None, result=newer)

        store._prune_terminal_jobs()

        assert set(store._jobs) == {"older-valid"}
    finally:
        store._executor.shutdown(wait=True)


def test_cancelled_job_finalization_invalidates_cached_terminal_size(monkeypatch) -> None:
    started = threading.Event()
    release = threading.Event()
    finished = threading.Event()
    clock = iter([0.0, 1_000.0])

    def blocking_job(_request: JobRequest) -> tuple[dict, list[str]]:
        started.set()
        try:
            release.wait()
        finally:
            finished.set()
        return {}, []

    monkeypatch.setattr(app_module, "run_job", blocking_job)
    monkeypatch.setattr(app_module.time, "perf_counter", lambda: next(clock))

    async def exercise() -> None:
        store = JobStore(max_workers=1)
        try:
            accepted = await store.submit(_request())
            stored = store._jobs[accepted.jobId]
            task = stored.task
            assert task is not None
            assert await asyncio.to_thread(started.wait, 1)

            store.cancel(accepted.jobId)
            store._terminal_retention_bytes = len(stored.result.model_dump_json().encode("utf-8"))
            store._release_executor_job(accepted.jobId)
            assert stored.terminal_result_bytes == store._terminal_retention_bytes

            with pytest.raises(asyncio.CancelledError):
                await task

            assert stored.result.durationMs == 1_000_000.0
            assert (
                len(stored.result.model_dump_json().encode("utf-8"))
                > store._terminal_retention_bytes
            )
            assert accepted.jobId not in store._jobs
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 1)
            await asyncio.sleep(0)
            store._executor.shutdown(wait=True)

    asyncio.run(exercise())


def test_terminal_job_does_not_retain_full_request_payload() -> None:
    async def exercise() -> None:
        store = JobStore(max_workers=1)
        try:
            accepted = await store.submit(_request())
            task = store._jobs[accepted.jobId].task
            assert task is not None
            await task

            retained_request = getattr(store._jobs[accepted.jobId], "request", None)
            assert retained_request is None or retained_request.input == {}
        finally:
            store._executor.shutdown(wait=True)

    asyncio.run(exercise())
