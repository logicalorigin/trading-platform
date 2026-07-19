from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import FastAPI, HTTPException
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__
from .jobs import run_job
from .models import (
    CapabilitiesResponse,
    Capability,
    HealthResponse,
    JobAccepted,
    JobRequest,
    JobResult,
    JobStatus,
    JobType,
    _ensure_finite_numbers,
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class StoredJob:
    request: JobRequest | None
    result: JobResult
    task: asyncio.Task[None] | None = None
    executor_active: bool = False
    terminal_result_bytes: int | None = None


ALL_CAPABILITIES = [
    Capability(
        jobType=JobType.BENCHMARK_MATRIX,
        schemaVersion=1,
        description="Synthetic benchmark matrix for Python scientific compute workloads.",
    ),
    Capability(
        jobType=JobType.GREEK_SCENARIO_MATRIX,
        schemaVersion=1,
        description="Greek scenario matrix for option position-management analytics.",
    ),
    Capability(
        jobType=JobType.PORTFOLIO_RISK,
        schemaVersion=1,
        description="Portfolio exposure, scenario, covariance, and correlation analytics.",
    ),
    Capability(
        jobType=JobType.PORTFOLIO_OPTIMIZATION,
        schemaVersion=1,
        description="Advisory portfolio allocation, risk contribution, and turnover analytics.",
    ),
    Capability(
        jobType=JobType.SIGNAL_MATRIX,
        schemaVersion=1,
        description="Signal matrix indicator and event evaluation for completed chart bars.",
    ),
]

TERMINAL_JOB_STATUSES = {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}
TERMINAL_JOB_RETENTION_LIMIT = 200
TERMINAL_JOB_RETENTION_TTL = timedelta(hours=1)
DEFAULT_TERMINAL_JOB_RETENTION_BYTES = 100_000_000
MAX_PAYLOAD_MESSAGES = 4_096


class PayloadLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        limit = max_payload_bytes()
        content_length = dict(scope.get("headers", [])).get(b"content-length")
        if content_length is not None:
            try:
                declared_bytes = int(content_length)
            except ValueError:
                declared_bytes = 0
            if declared_bytes > limit:
                await JSONResponse(
                    status_code=413,
                    content={"detail": "python_compute_payload_too_large"},
                )(scope, receive, send)
                return

        body = bytearray()
        message_count = 0
        saw_request = False
        saw_disconnect = False
        while True:
            message = await receive()
            message_count += 1
            if message_count > MAX_PAYLOAD_MESSAGES:
                await JSONResponse(
                    status_code=413,
                    content={"detail": "python_compute_payload_too_large"},
                )(scope, receive, send)
                return
            if message["type"] == "http.disconnect":
                saw_disconnect = True
                break
            if message["type"] != "http.request":
                continue
            saw_request = True
            chunk = message.get("body", b"")
            if len(chunk) > limit - len(body):
                await JSONResponse(
                    status_code=413,
                    content={"detail": "python_compute_payload_too_large"},
                )(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        replayed_request = False

        async def replay_receive() -> Message:
            nonlocal replayed_request
            if replayed_request or not saw_request:
                return {"type": "http.disconnect"}
            replayed_request = True
            return {
                "type": "http.request",
                "body": bytes(body),
                "more_body": saw_disconnect,
            }

        await self.app(scope, replay_receive, send)


def parse_allowed_job_types(raw: str | None) -> set[JobType] | None:
    if raw is None:
        return None
    if raw.strip() == "":
        return set()
    return normalize_allowed_job_types(
        raw_value for raw_value in raw.split(",") if raw_value.strip()
    )


def normalize_allowed_job_types(
    values: Iterable[JobType | str] | None,
) -> set[JobType] | None:
    if values is None:
        return None
    return {
        value if isinstance(value, JobType) else JobType(str(value).strip()) for value in values
    }


class JobStore:
    def __init__(
        self,
        max_workers: int | None = None,
        lane: str | None = None,
        allowed_job_types: Iterable[JobType | str] | None = None,
    ) -> None:
        worker_count = max_workers or max(1, (os.cpu_count() or 2) - 1)
        self._executor = ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="pyrus-compute",
        )
        self._jobs: dict[str, StoredJob] = {}
        self._completed_jobs = 0
        self._failed_jobs = 0
        self._lane = lane or os.environ.get("PYRUS_PYTHON_COMPUTE_LANE", "default")
        self._terminal_retention_bytes = terminal_job_retention_bytes()
        self._allowed_job_types = (
            parse_allowed_job_types(os.environ.get("PYRUS_PYTHON_COMPUTE_ALLOWED_JOB_TYPES"))
            if allowed_job_types is None
            else normalize_allowed_job_types(allowed_job_types)
        )

    @property
    def active_jobs(self) -> int:
        return self._in_flight_jobs()

    @property
    def completed_jobs(self) -> int:
        return self._completed_jobs

    @property
    def failed_jobs(self) -> int:
        return self._failed_jobs

    @property
    def lane(self) -> str:
        return self._lane

    @property
    def allowed_job_types(self) -> set[JobType]:
        if self._allowed_job_types is None:
            return {capability.jobType for capability in ALL_CAPABILITIES}
        return self._allowed_job_types

    def _in_flight_jobs(self) -> int:
        return sum(
            1
            for job in self._jobs.values()
            if job.executor_active or job.result.status in {JobStatus.QUEUED, JobStatus.RUNNING}
        )

    def _terminal_result_bytes(self, job: StoredJob) -> int | None:
        if job.terminal_result_bytes is not None:
            return job.terminal_result_bytes
        try:
            # ponytail: JSON bytes bound retained response payloads, not allocator
            # overhead; upgrade to deep sizing if JobResult retains non-response state.
            result_bytes = len(job.result.model_dump_json().encode("utf-8"))
        except (TypeError, ValueError):
            return None
        job.terminal_result_bytes = result_bytes
        return result_bytes

    def _prune_terminal_jobs(self) -> None:
        cutoff = datetime.now(UTC) - TERMINAL_JOB_RETENTION_TTL
        terminal_jobs: list[tuple[datetime, str, int]] = []
        for job_id, job in list(self._jobs.items()):
            if job.result.status not in TERMINAL_JOB_STATUSES or job.executor_active:
                continue
            completed_at_raw = job.result.completedAt
            try:
                completed_at = (
                    datetime.fromisoformat(completed_at_raw)
                    if completed_at_raw is not None
                    else None
                )
                if completed_at is not None and completed_at.tzinfo is None:
                    completed_at = completed_at.replace(tzinfo=UTC)
            except ValueError:
                completed_at = None
            if completed_at is None or completed_at <= cutoff:
                del self._jobs[job_id]
                continue
            result_bytes = self._terminal_result_bytes(job)
            if result_bytes is None:
                del self._jobs[job_id]
                continue
            terminal_jobs.append((completed_at, job_id, result_bytes))
        terminal_jobs.sort(key=lambda item: (item[0], item[1]))
        retained_jobs = terminal_jobs[-TERMINAL_JOB_RETENTION_LIMIT:]
        for _, job_id, _ in terminal_jobs[:-TERMINAL_JOB_RETENTION_LIMIT]:
            del self._jobs[job_id]
        retained_bytes = sum(result_bytes for _, _, result_bytes in retained_jobs)
        for _, job_id, result_bytes in retained_jobs:
            if retained_bytes <= self._terminal_retention_bytes:
                break
            del self._jobs[job_id]
            retained_bytes -= result_bytes

    def _release_executor_job(self, job_id: str) -> None:
        stored = self._jobs.get(job_id)
        if stored is not None:
            stored.executor_active = False
        self._prune_terminal_jobs()

    async def submit(self, request: JobRequest) -> JobAccepted:
        if request.jobType not in self.allowed_job_types:
            raise HTTPException(
                status_code=403,
                detail="python_compute_job_type_not_allowed_for_lane",
            )
        self._prune_terminal_jobs()
        if self._in_flight_jobs() >= max_concurrent_jobs():
            raise HTTPException(status_code=429, detail="python_compute_job_capacity_exhausted")

        job_id = uuid.uuid4().hex
        result = JobResult(
            jobId=job_id,
            jobType=request.jobType,
            status=JobStatus.QUEUED,
            createdAt=utc_now(),
        )
        stored = StoredJob(request=request, result=result)
        self._jobs[job_id] = stored
        stored.task = asyncio.create_task(self._run(job_id))
        return JobAccepted(jobId=job_id, status=result.status)

    def get(self, job_id: str) -> JobResult:
        self._prune_terminal_jobs()
        stored = self._jobs.get(job_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="python_compute_job_not_found")
        return stored.result

    def cancel(self, job_id: str) -> JobResult:
        self._prune_terminal_jobs()
        stored = self._jobs.get(job_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="python_compute_job_not_found")
        if stored.result.status in TERMINAL_JOB_STATUSES:
            return stored.result
        stored.result.status = JobStatus.CANCELLED
        stored.result.completedAt = utc_now()
        stored.request = None
        if stored.task is not None:
            stored.task.cancel()
        self._prune_terminal_jobs()
        return stored.result

    async def _run(self, job_id: str) -> None:
        stored = self._jobs[job_id]
        if stored.result.status == JobStatus.CANCELLED:
            stored.request = None
            self._prune_terminal_jobs()
            return
        request = stored.request
        if request is None:
            raise RuntimeError("queued job request was released before execution")
        stored.result.status = JobStatus.RUNNING
        stored.result.startedAt = utc_now()
        started = time.perf_counter()
        try:
            loop = asyncio.get_running_loop()
            stored.executor_active = True
            try:
                executor_future = self._executor.submit(run_job, request)
            except Exception:  # noqa: BLE001
                stored.executor_active = False
                raise
            executor_future.add_done_callback(
                lambda _future: loop.call_soon_threadsafe(self._release_executor_job, job_id)
            )
            result, warnings = await asyncio.wait_for(
                asyncio.wrap_future(executor_future),
                timeout=request.options.timeoutMs / 1000,
            )
            if stored.result.status == JobStatus.CANCELLED:
                return
            _ensure_finite_numbers(result, "result")
            stored.result.result = result
            stored.result.warnings = warnings
            stored.result.status = JobStatus.COMPLETED
            self._completed_jobs += 1
        except TimeoutError:
            stored.result.status = JobStatus.FAILED
            stored.result.error = {
                "code": "python_compute_job_timeout",
                "message": "Job timed out.",
            }
            self._failed_jobs += 1
        except Exception:  # noqa: BLE001
            stored.result.status = JobStatus.FAILED
            stored.result.error = {
                "code": "python_compute_job_failed",
                "message": "Job failed.",
            }
            self._failed_jobs += 1
        finally:
            stored.request = None
            if stored.result.status != JobStatus.CANCELLED:
                stored.result.completedAt = utc_now()
            stored.result.durationMs = round((time.perf_counter() - started) * 1000, 4)
            stored.terminal_result_bytes = None
            self._prune_terminal_jobs()


def max_concurrent_jobs() -> int:
    raw = os.environ.get("PYRUS_PYTHON_COMPUTE_MAX_JOBS", "2")
    try:
        value = int(raw)
    except ValueError:
        return 2
    return max(1, min(value, 32))


def terminal_job_retention_bytes() -> int:
    raw = os.environ.get(
        "PYRUS_PYTHON_COMPUTE_TERMINAL_RETENTION_BYTES",
        str(DEFAULT_TERMINAL_JOB_RETENTION_BYTES),
    )
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_TERMINAL_JOB_RETENTION_BYTES
    return max(1_024, value)


def max_payload_bytes() -> int:
    raw = os.environ.get("PYRUS_PYTHON_COMPUTE_MAX_PAYLOAD_BYTES", "5000000")
    try:
        value = int(raw)
    except ValueError:
        return 5_000_000
    return max(1_024, min(value, 100_000_000))


def create_app(job_store: JobStore | None = None) -> FastAPI:
    store = job_store or JobStore()
    app = FastAPI(title="PYRUS Compute", version=__version__)
    app.add_middleware(PayloadLimitMiddleware)

    @app.get("/health", response_model=HealthResponse)
    async def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            service="pyrus-compute",
            version=__version__,
            lane=store.lane,
            activeJobs=store.active_jobs,
            maxActiveJobs=max_concurrent_jobs(),
            completedJobs=store.completed_jobs,
            failedJobs=store.failed_jobs,
            allowedJobTypes=sorted(store.allowed_job_types),
        )

    @app.get("/capabilities", response_model=CapabilitiesResponse)
    async def capabilities() -> CapabilitiesResponse:
        return CapabilitiesResponse(
            service="pyrus-compute",
            capabilities=[
                capability
                for capability in ALL_CAPABILITIES
                if capability.jobType in store.allowed_job_types
            ],
        )

    @app.post("/jobs", response_model=JobAccepted, status_code=202)
    async def create_job(request: JobRequest) -> JobAccepted:
        return await store.submit(request)

    @app.get("/jobs/{job_id}", response_model=JobResult)
    async def get_job(job_id: str) -> JobResult:
        return store.get(job_id)

    @app.post("/jobs/{job_id}/cancel", response_model=JobResult)
    async def cancel_job(job_id: str) -> JobResult:
        return store.cancel(job_id)

    return app


app = create_app()
