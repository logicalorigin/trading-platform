from __future__ import annotations

import math
from enum import StrEnum
from numbers import Real
from typing import Annotated, Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_GREEK_SCENARIO_WORK_ITEMS = 1_000_000
MAX_NUMERIC_TREE_DEPTH = 100
MAX_NUMERIC_TREE_NODES = 100_000


def _ensure_finite_numbers(value: Any, path: str = "value") -> None:
    stack: list[tuple[Any, str, int]] = [(value, path, 0)]
    visited = 0
    while stack:
        item, item_path, depth = stack.pop()
        visited += 1
        if visited > MAX_NUMERIC_TREE_NODES:
            raise ValueError(f"{path} exceeds the numeric tree node limit")
        if depth > MAX_NUMERIC_TREE_DEPTH:
            raise ValueError(f"{path} exceeds the numeric tree depth limit")
        if isinstance(item, int):
            continue
        if isinstance(item, Real):
            try:
                is_finite = math.isfinite(float(item))
            except (OverflowError, TypeError, ValueError) as error:
                raise ValueError(f"{item_path} must contain only finite numbers") from error
            if not is_finite:
                raise ValueError(f"{item_path} must contain only finite numbers")
            continue
        if isinstance(item, dict):
            if len(item) > MAX_NUMERIC_TREE_NODES - visited - len(stack):
                raise ValueError(f"{path} exceeds the numeric tree node limit")
            stack.extend((child, f"{item_path}.{key}", depth + 1) for key, child in item.items())
            continue
        if isinstance(item, list | tuple):
            if len(item) > MAX_NUMERIC_TREE_NODES - visited - len(stack):
                raise ValueError(f"{path} exceeds the numeric tree node limit")
            stack.extend(
                (child, f"{item_path}[{index}]", depth + 1) for index, child in enumerate(item)
            )


class JobType(StrEnum):
    BENCHMARK_MATRIX = "benchmark_matrix"
    GREEK_SCENARIO_MATRIX = "greek_scenario_matrix"
    PORTFOLIO_OPTIMIZATION = "portfolio_optimization"
    PORTFOLIO_RISK = "portfolio_risk"
    SIGNAL_MATRIX = "signal_matrix"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class PositionInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    quantity: float
    price: Annotated[float, Field(ge=0)]
    delta: float | None = None
    sector: str | None = Field(default=None, max_length=80)


class ReturnSeriesInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    values: list[float] = Field(default_factory=list, max_length=10_000)


class PortfolioRiskInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    currentWeight: float = 0
    expectedReturn: float | None = None


class PortfolioOptimizationConstraints(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    longOnly: bool = True
    maxWeight: Annotated[float, Field(gt=0, le=1)] | None = None
    maxTurnover: Annotated[float, Field(ge=0, le=2)] | None = None


class PortfolioOptimizationInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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

    @model_validator(mode="after")
    def validate_work_budget(self) -> Self:
        work_items = (
            len(self.positions) * len(self.spotShocks) * len(self.ivShocks) * len(self.dayOffsets)
        )
        if work_items > MAX_GREEK_SCENARIO_WORK_ITEMS:
            raise ValueError(
                "greek scenario matrix exceeds the 1,000,000 position-scenario work-item limit"
            )
        return self


class BenchmarkMatrixInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rows: Annotated[int, Field(ge=100, le=250_000)] = 10_000
    trials: Annotated[int, Field(ge=1, le=50)] = 5
    seed: int = 42_417


class SignalMatrixSettingsInput(BaseModel):
    model_config = ConfigDict(extra="allow", allow_inf_nan=False)

    timeHorizon: Annotated[int, Field(ge=2, le=40)] = 10
    bosConfirmation: Literal["close", "wicks"] = "close"
    chochAtrBuffer: Annotated[float, Field(ge=0, le=20)] = 0
    chochBodyExpansionAtr: Annotated[float, Field(ge=0, le=20)] = 0
    chochVolumeGate: Annotated[float, Field(ge=0, le=20)] = 0
    basisLength: Annotated[int, Field(ge=1, le=240)] = 80
    atrLength: Annotated[int, Field(ge=1, le=100)] = 14
    atrSmoothing: Annotated[int, Field(ge=1, le=200)] = 21
    volatilityMultiplier: Annotated[float, Field(ge=0.1, le=10)] = 2
    wireSpread: Annotated[float, Field(ge=0.01, le=10)] = 0.5
    shadowLength: Annotated[int, Field(ge=1, le=120)] = 20
    shadowStdDev: Annotated[float, Field(ge=0.001, le=50)] = 2
    adxLength: Annotated[int, Field(ge=1, le=100)] = 14
    volumeMaLength: Annotated[int, Field(ge=1, le=200)] = 20
    mtf1: str = Field(default="1h", max_length=16)
    mtf2: str = Field(default="4h", max_length=16)
    mtf3: str = Field(default="D", max_length=16)
    signalFiltersEnabled: bool = False
    requireMtf1: bool = False
    requireMtf2: bool = False
    requireMtf3: bool = False
    requireAdx: bool = False
    adxMin: Annotated[float, Field(ge=1, le=100)] = 20
    requireVolScoreRange: bool = False
    volScoreMin: Annotated[float, Field(ge=0, le=10)] = 2
    volScoreMax: Annotated[float, Field(ge=0, le=10)] = 10
    restrictToSelectedSessions: bool = False
    sessions: list[str] = Field(default_factory=list, max_length=16)
    waitForBarClose: bool = True
    signalOffsetAtr: Annotated[float, Field(ge=0, le=20)] = 3


class SignalMatrixBarInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    time: int
    ts: str | None = None
    date: str | None = None
    o: float
    h: float
    l: float  # noqa: E741 - wire-format key shared with the TypeScript bar contract
    c: float
    v: float = 0


class SignalMatrixCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: Annotated[str, Field(min_length=1, max_length=32)]
    timeframe: Annotated[str, Field(min_length=1, max_length=16)]
    freshWindowBars: Annotated[int, Field(ge=0, le=200)] = 3
    settings: SignalMatrixSettingsInput = Field(default_factory=SignalMatrixSettingsInput)
    bars: list[SignalMatrixBarInput] = Field(default_factory=list, max_length=5_000)


class SignalMatrixInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evaluatedAt: str | None = None
    cells: list[SignalMatrixCellInput] = Field(default_factory=list, max_length=1_000)


class JobOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    timeoutMs: Annotated[int, Field(ge=100, le=300_000)] = 30_000


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    jobType: JobType
    schemaVersion: Literal[1] = 1
    input: dict[str, Any] = Field(default_factory=dict)
    options: JobOptions = Field(default_factory=JobOptions)

    @field_validator("input")
    @classmethod
    def validate_finite_input(cls, value: dict[str, Any]) -> dict[str, Any]:
        _ensure_finite_numbers(value, "input")
        return value


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
    lane: str
    activeJobs: int
    maxActiveJobs: int
    completedJobs: int
    failedJobs: int
    allowedJobTypes: list[JobType]
