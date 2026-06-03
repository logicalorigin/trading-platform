from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .registry import DesiredGeneration, DesiredLine, LineOwner, LineStatus, MarketDataRegistry


class SidecarModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class LineOwnerModel(SidecarModel):
    owner: str
    owner_class: str | None = Field(default=None, alias="ownerClass")
    intent: str
    pool: str | None = None
    priority: int | None = None

    def to_registry_owner(self) -> LineOwner:
        return LineOwner(
            owner=self.owner,
            owner_class=self.owner_class,
            intent=self.intent,
            pool=self.pool,
            priority=self.priority,
        )

    @classmethod
    def from_registry_owner(cls, owner: LineOwner) -> LineOwnerModel:
        return cls(
            owner=owner.owner,
            ownerClass=owner.owner_class,
            intent=owner.intent,
            pool=owner.pool,
            priority=owner.priority,
        )


class LineContractModel(SidecarModel):
    symbol: str | None = None
    provider_contract_id: str | None = Field(default=None, alias="providerContractId")


class DesiredLineModel(SidecarModel):
    line_key: str = Field(alias="lineKey", min_length=1)
    asset_class: Literal["equity", "option"] = Field(alias="assetClass")
    contract: LineContractModel
    intent: str
    owners: tuple[LineOwnerModel, ...] = ()
    priority: int | None = None
    reason: str | None = None

    def to_registry_line(self) -> DesiredLine:
        return DesiredLine(
            line_key=self.line_key,
            asset_class=self.asset_class,
            symbol=self.contract.symbol,
            provider_contract_id=self.contract.provider_contract_id,
            intent=self.intent,
            owners=tuple(owner.to_registry_owner() for owner in self.owners),
            priority=self.priority,
        )


class DesiredGenerationSummary(SidecarModel):
    desired_line_count: int = Field(alias="desiredLineCount")
    desired_equity_line_count: int = Field(alias="desiredEquityLineCount")
    desired_option_line_count: int = Field(alias="desiredOptionLineCount")
    owner_count: int = Field(alias="ownerCount")


class DesiredGenerationRequest(SidecarModel):
    schema_version: Literal[1] = Field(alias="schemaVersion")
    generation_id: str = Field(alias="generationId", min_length=1)
    source: Literal["api-market-data-work-planner"]
    generated_at: str = Field(alias="generatedAt")
    desired_lines: tuple[DesiredLineModel, ...] = Field(alias="desiredLines")
    summary: DesiredGenerationSummary

    def to_registry_generation(self) -> DesiredGeneration:
        return DesiredGeneration(
            generation_id=self.generation_id,
            generated_at=self.generated_at,
            desired_lines=tuple(line.to_registry_line() for line in self.desired_lines),
        )


class LineStatusModel(SidecarModel):
    line_key: str = Field(alias="lineKey")
    asset_class: Literal[
        "equity",
        "option",
    ] = Field(alias="assetClass")
    state: Literal[
        "subscribing",
        "live",
        "releasing",
        "released",
        "failed",
        "stale",
        "unexpected",
    ]
    contract: LineContractModel
    owners: tuple[LineOwnerModel, ...]
    subscribed_at: str | None = Field(default=None, alias="subscribedAt")
    last_tick_at: str | None = Field(default=None, alias="lastTickAt")
    release_requested_at: str | None = Field(default=None, alias="releaseRequestedAt")
    error: str | None = None

    @classmethod
    def from_registry_line(cls, line: LineStatus) -> LineStatusModel:
        return cls(
            lineKey=line.line_key,
            assetClass=line.asset_class,
            state=line.state,
            contract=LineContractModel(
                symbol=line.symbol,
                providerContractId=line.provider_contract_id,
            ),
            owners=tuple(LineOwnerModel.from_registry_owner(owner) for owner in line.owners),
            subscribedAt=line.subscribed_at,
            lastTickAt=line.last_tick_at,
            releaseRequestedAt=line.release_requested_at,
            error=line.error,
        )


class GenerationStatusSummary(SidecarModel):
    live_line_count: int = Field(alias="liveLineCount")
    live_equity_line_count: int = Field(alias="liveEquityLineCount")
    live_option_line_count: int = Field(alias="liveOptionLineCount")
    subscribing_line_count: int = Field(alias="subscribingLineCount")
    releasing_line_count: int = Field(alias="releasingLineCount")
    failed_line_count: int = Field(alias="failedLineCount")
    unexpected_line_count: int = Field(alias="unexpectedLineCount")


class GenerationThrottleStatus(SidecarModel):
    throttled: bool = False
    queue_depth: int | None = Field(default=None, alias="queueDepth")
    max_requests: int | None = Field(default=None, alias="maxRequests")
    requests_interval_sec: int | None = Field(default=None, alias="requestsIntervalSec")
    last_throttle_start_at: str | None = Field(default=None, alias="lastThrottleStartAt")
    last_throttle_end_at: str | None = Field(default=None, alias="lastThrottleEndAt")


class GenerationStatusResponse(SidecarModel):
    schema_version: Literal[1] = Field(default=1, alias="schemaVersion")
    mode: Literal["observer", "executor"]
    source: Literal["ib-async-sidecar"] = "ib-async-sidecar"
    generation_id: str | None = Field(default=None, alias="generationId")
    applied_generation_id: str | None = Field(default=None, alias="appliedGenerationId")
    updated_at: str = Field(alias="updatedAt")
    lines: tuple[LineStatusModel, ...]
    summary: GenerationStatusSummary
    throttle: GenerationThrottleStatus = Field(default_factory=GenerationThrottleStatus)

    @classmethod
    def from_registry(
        cls,
        registry: MarketDataRegistry,
        *,
        updated_at: str,
        generation_id: str | None = None,
    ) -> GenerationStatusResponse:
        lines = registry.lines
        live = [line for line in lines if line.state == "live"]
        return cls(
            mode="executor" if registry.applied_generation_id else "observer",
            generationId=generation_id or registry.applied_generation_id,
            appliedGenerationId=registry.applied_generation_id,
            updatedAt=updated_at,
            lines=tuple(LineStatusModel.from_registry_line(line) for line in lines),
            summary=GenerationStatusSummary(
                liveLineCount=len(live),
                liveEquityLineCount=sum(1 for line in live if line.asset_class == "equity"),
                liveOptionLineCount=sum(1 for line in live if line.asset_class == "option"),
                subscribingLineCount=sum(1 for line in lines if line.state == "subscribing"),
                releasingLineCount=sum(1 for line in lines if line.state == "releasing"),
                failedLineCount=sum(1 for line in lines if line.state == "failed"),
                unexpectedLineCount=sum(1 for line in lines if line.state == "unexpected"),
            ),
        )


class HealthResponse(SidecarModel):
    ok: bool
    service: Literal["pyrus-ibkr-sidecar"] = "pyrus-ibkr-sidecar"
    version: str
    applied_generation_id: str | None = Field(default=None, alias="appliedGenerationId")
    live_line_count: int = Field(alias="liveLineCount")
    failed_line_count: int = Field(alias="failedLineCount")
