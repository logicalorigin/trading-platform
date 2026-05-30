from __future__ import annotations

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class JobType(StrEnum):
    BENCHMARK_MATRIX = "benchmark_matrix"
    GREEK_SCENARIO_MATRIX = "greek_scenario_matrix"
    PORTFOLIO_OPTIMIZATION = "portfolio_optimization"
    PORTFOLIO_RISK = "portfolio_risk"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PositionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    quantity: float
    price: Annotated[float, Field(ge=0)]
    delta: float | None = None
    sector: str | None = Field(default=None, max_length=80)


class ReturnSeriesInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    values: list[float] = Field(default_factory=list, max_length=10_000)


class PortfolioRiskInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[PositionInput] = Field(default_factory=list, max_length=5_000)
    returns: list[ReturnSeriesInput] = Field(default_factory=list, max_length=1_000)
    shocks: list[float] = Field(default_factory=lambda: [-0.05, -0.02, 0.02, 0.05], max_length=25)

    @field_validator("shocks")
    @classmethod
    def validate_shocks(cls, value: list[float]) -> list[float]:
        return [shock for shock in value if abs(shock) <= 1]


class PortfolioOptimizationObjective(StrEnum):
    MIN_VARIANCE = "min_variance"
    RISK_PARITY = "risk_parity"
    MAX_RETURN = "max_return"


class PortfolioOptimizationPositionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    currentWeight: float = 0
    expectedReturn: float | None = None


class PortfolioOptimizationConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid")

    longOnly: bool = True
    maxWeight: Annotated[float, Field(gt=0, le=1)] | None = None
    maxTurnover: Annotated[float, Field(ge=0, le=2)] | None = None


class PortfolioOptimizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[PortfolioOptimizationPositionInput] = Field(
        default_factory=list,
        max_length=1_000,
    )
    returns: list[ReturnSeriesInput] = Field(default_factory=list, max_length=1_000)
    covariance: list[list[float]] | None = Field(default=None, max_length=1_000)
    objective: PortfolioOptimizationObjective = PortfolioOptimizationObjective.MIN_VARIANCE
    constraints: PortfolioOptimizationConstraints = Field(
        default_factory=PortfolioOptimizationConstraints,
    )


class GreekScale(StrEnum):
    PER_CONTRACT = "per_contract"
    POSITION = "position"


class GreekScenarioPricingModel(StrEnum):
    AUTO = "auto"
    BLACK_SCHOLES = "black_scholes"
    BOUNDED_GREEK_APPROXIMATION = "bounded_greek_approximation"


class GreekPositionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Annotated[str, Field(min_length=1, max_length=80)]
    underlying: Annotated[str, Field(min_length=1, max_length=32)]
    quantity: float = 1
    multiplier: Annotated[float, Field(gt=0)] = 100
    spot: Annotated[float, Field(gt=0)]
    markPrice: Annotated[float, Field(ge=0)] = 0
    strike: Annotated[float, Field(gt=0)] | None = None
    right: Literal["call", "put"] | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None
    impliedVolatility: float | None = None
    daysToExpiration: float | None = None
    riskFreeRate: float | None = None
    dividendYield: float | None = None
    pricingModel: GreekScenarioPricingModel = GreekScenarioPricingModel.AUTO
    greekScale: GreekScale = GreekScale.PER_CONTRACT


class GreekScenarioMatrixInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    positions: list[GreekPositionInput] = Field(default_factory=list, max_length=5_000)
    spotShocks: list[float] = Field(
        default_factory=lambda: [-0.08, -0.05, -0.02, 0.0, 0.02, 0.05, 0.08],
        max_length=51,
    )
    ivShocks: list[float] = Field(
        default_factory=lambda: [-10.0, -5.0, 0.0, 5.0, 10.0],
        max_length=31,
    )
    dayOffsets: list[float] = Field(default_factory=lambda: [0.0, 1.0, 3.0, 5.0], max_length=31)

    @field_validator("spotShocks")
    @classmethod
    def validate_spot_shocks(cls, value: list[float]) -> list[float]:
        return [shock for shock in value if abs(shock) <= 1]

    @field_validator("ivShocks")
    @classmethod
    def validate_iv_shocks(cls, value: list[float]) -> list[float]:
        return [shock for shock in value if abs(shock) <= 100]

    @field_validator("dayOffsets")
    @classmethod
    def validate_day_offsets(cls, value: list[float]) -> list[float]:
        return [offset for offset in value if 0 <= offset <= 365]


class BenchmarkMatrixInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: Annotated[int, Field(ge=100, le=250_000)] = 10_000
    trials: Annotated[int, Field(ge=1, le=50)] = 5
    seed: int = 42_417


class JobOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeoutMs: Annotated[int, Field(ge=100, le=300_000)] = 30_000


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobType: JobType
    schemaVersion: Literal[1] = 1
    input: dict[str, Any] = Field(default_factory=dict)
    options: JobOptions = Field(default_factory=JobOptions)


class JobAccepted(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    status: JobStatus


class JobResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobId: str
    jobType: JobType
    status: JobStatus
    createdAt: str
    startedAt: str | None = None
    completedAt: str | None = None
    durationMs: float | None = None
    warnings: list[str] = Field(default_factory=list)
    result: dict[str, Any] | None = None
    error: dict[str, str] | None = None


class Capability(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobType: JobType
    schemaVersion: Literal[1]
    description: str


class CapabilitiesResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service: Literal["pyrus-compute"]
    capabilities: list[Capability]


class HealthResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ok: bool
    service: Literal["pyrus-compute"]
    version: str
    activeJobs: int
    completedJobs: int
    failedJobs: int
