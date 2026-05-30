from __future__ import annotations

import asyncio
import os
import time
import uuid
from collections.abc import Awaitable, Callable
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


class JobStore:
    def __init__(self, max_workers: int | None = None) -> None:
        worker_count = max_workers or max(1, (os.cpu_count() or 2) - 1)
        self._executor = ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="pyrus-compute",
        )
        self._jobs: dict[str, StoredJob] = {}
        self._completed_jobs = 0
        self._failed_jobs = 0

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

    async def submit(self, request: JobRequest) -> JobAccepted:
        if self.active_jobs >= max_concurrent_jobs():
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
        if stored.result.status in {JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED}:
            return stored.result
        stored.result.status = JobStatus.CANCELLED
        stored.result.completedAt = utc_now()
        if stored.task is not None:
            stored.task.cancel()
        return stored.result

    async def _run(self, job_id: str) -> None:
        stored = self._jobs[job_id]
        if stored.result.status == JobStatus.CANCELLED:
            return
        stored.result.status = JobStatus.RUNNING
        stored.result.startedAt = utc_now()
        started = time.perf_counter()
        try:
            loop = asyncio.get_running_loop()
            result, warnings = await asyncio.wait_for(
                loop.run_in_executor(self._executor, run_job, stored.request),
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
            activeJobs=store.active_jobs,
            completedJobs=store.completed_jobs,
            failedJobs=store.failed_jobs,
        )

    @app.get("/capabilities", response_model=CapabilitiesResponse)
    async def capabilities() -> CapabilitiesResponse:
        return CapabilitiesResponse(
            service="pyrus-compute",
            capabilities=[
                Capability(
                    jobType=JobType.BENCHMARK_MATRIX,
                    schemaVersion=1,
                    description=(
                        "Synthetic benchmark matrix for Python scientific compute workloads."
                    ),
                ),
                Capability(
                    jobType=JobType.GREEK_SCENARIO_MATRIX,
                    schemaVersion=1,
                    description=(
                        "Greek scenario matrix for option position-management analytics."
                    ),
                ),
                Capability(
                    jobType=JobType.PORTFOLIO_RISK,
                    schemaVersion=1,
                    description=(
                        "Portfolio exposure, scenario, covariance, and correlation analytics."
                    ),
                ),
                Capability(
                    jobType=JobType.PORTFOLIO_OPTIMIZATION,
                    schemaVersion=1,
                    description=(
                        "Advisory portfolio allocation, risk contribution, and turnover analytics."
                    ),
                ),
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
