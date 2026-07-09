from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Awaitable, Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

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
)


def utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class StoredJob:
    request: JobRequest
    result: JobResult
    task: asyncio.Task[None] | None = None
    executor_active: bool = False


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
        self._allowed_job_types = (
            parse_allowed_job_types(os.environ.get("PYRUS_PYTHON_COMPUTE_ALLOWED_JOB_TYPES"))
            if allowed_job_types is None
            else normalize_allowed_job_types(allowed_job_types)
        )

    @property
    def active_jobs(self) -> int:
        return sum(
            1
            for job in self._jobs.values()
            if job.result.status in {JobStatus.QUEUED, JobStatus.RUNNING}
        )

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
            if job.executor_active
            or job.result.status in {JobStatus.QUEUED, JobStatus.RUNNING}
        )

    def _prune_terminal_jobs(self) -> None:
        terminal_job_ids = [
            job_id
            for job_id, job in self._jobs.items()
            if job.result.status in TERMINAL_JOB_STATUSES and not job.executor_active
        ]
        for job_id in terminal_job_ids[:-TERMINAL_JOB_RETENTION_LIMIT]:
            del self._jobs[job_id]

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
        stored = self._jobs.get(job_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="python_compute_job_not_found")
        return stored.result

    def cancel(self, job_id: str) -> JobResult:
        stored = self._jobs.get(job_id)
        if stored is None:
            raise HTTPException(status_code=404, detail="python_compute_job_not_found")
        if stored.result.status in TERMINAL_JOB_STATUSES:
            return stored.result
        stored.result.status = JobStatus.CANCELLED
        stored.result.completedAt = utc_now()
        if stored.task is not None:
            stored.task.cancel()
        self._prune_terminal_jobs()
        return stored.result

    async def _run(self, job_id: str) -> None:
        stored = self._jobs[job_id]
        if stored.result.status == JobStatus.CANCELLED:
            self._prune_terminal_jobs()
            return
        stored.result.status = JobStatus.RUNNING
        stored.result.startedAt = utc_now()
        started = time.perf_counter()
        try:
            loop = asyncio.get_running_loop()
            stored.executor_active = True
            try:
                executor_future = self._executor.submit(run_job, stored.request)
            except Exception:  # noqa: BLE001
                stored.executor_active = False
                raise
            executor_future.add_done_callback(
                lambda _future: loop.call_soon_threadsafe(self._release_executor_job, job_id)
            )
            result, warnings = await asyncio.wait_for(
                asyncio.wrap_future(executor_future),
                timeout=stored.request.options.timeoutMs / 1000,
            )
            if stored.result.status == JobStatus.CANCELLED:
                return
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
        except Exception as exc:  # noqa: BLE001
            stored.result.status = JobStatus.FAILED
            stored.result.error = {
                "code": "python_compute_job_failed",
                "message": str(exc),
            }
            self._failed_jobs += 1
        finally:
            if stored.result.status != JobStatus.CANCELLED:
                stored.result.completedAt = utc_now()
            stored.result.durationMs = round((time.perf_counter() - started) * 1000, 4)
            self._prune_terminal_jobs()


def max_concurrent_jobs() -> int:
    raw = os.environ.get("PYRUS_PYTHON_COMPUTE_MAX_JOBS", "2")
    try:
        value = int(raw)
    except ValueError:
        return 2
    return max(1, min(value, 32))


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

    @app.middleware("http")
    async def enforce_payload_limit(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                payload_bytes = int(content_length)
            except ValueError:
                payload_bytes = 0
            if payload_bytes > max_payload_bytes():
                return JSONResponse(
                    status_code=413,
                    content={"detail": "python_compute_payload_too_large"},
                )
        return await call_next(request)

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
