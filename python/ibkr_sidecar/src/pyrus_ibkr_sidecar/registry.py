from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal, Protocol

AssetClass = Literal["equity", "option"]
LineState = Literal[
    "subscribing",
    "live",
    "releasing",
    "released",
    "failed",
    "stale",
    "unexpected",
]


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class LineOwner:
    owner: str
    owner_class: str | None
    intent: str
    pool: str | None
    priority: int | None


@dataclass(frozen=True)
class DesiredLine:
    line_key: str
    asset_class: AssetClass
    symbol: str | None
    provider_contract_id: str | None
    intent: str
    owners: tuple[LineOwner, ...]
    priority: int | None


@dataclass(frozen=True)
class DesiredGeneration:
    generation_id: str
    generated_at: str
    desired_lines: tuple[DesiredLine, ...]


@dataclass
class SubscriptionHandle:
    line_key: str
    contract: object
    ticker: object


class IbkrMarketDataAdapter(Protocol):
    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        """Create or reuse an ib_async live market-data subscription."""

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        """Cancel a previously subscribed ib_async live market-data line."""


@dataclass
class LineStatus:
    line_key: str
    asset_class: AssetClass
    state: LineState
    symbol: str | None
    provider_contract_id: str | None
    owners: tuple[LineOwner, ...]
    subscribed_at: str | None = None
    last_tick_at: str | None = None
    release_requested_at: str | None = None
    error: str | None = None
    handle: SubscriptionHandle | None = field(default=None, repr=False, compare=False)


class MarketDataRegistry:
    def __init__(self, adapter: IbkrMarketDataAdapter) -> None:
        self._adapter = adapter
        self._lines: dict[str, LineStatus] = {}
        self.applied_generation_id: str | None = None

    @property
    def lines(self) -> tuple[LineStatus, ...]:
        return tuple(sorted(self._lines.values(), key=lambda line: line.line_key))

    async def apply_generation(self, generation: DesiredGeneration) -> tuple[LineStatus, ...]:
        desired_by_key = {line.line_key: line for line in generation.desired_lines}

        for desired in desired_by_key.values():
            current = self._lines.get(desired.line_key)
            if current and current.state in {"live", "subscribing"}:
                current.owners = desired.owners
                current.symbol = desired.symbol
                current.provider_contract_id = desired.provider_contract_id
                current.asset_class = desired.asset_class
                continue

            status = LineStatus(
                line_key=desired.line_key,
                asset_class=desired.asset_class,
                state="subscribing",
                symbol=desired.symbol,
                provider_contract_id=desired.provider_contract_id,
                owners=desired.owners,
            )
            self._lines[desired.line_key] = status
            try:
                status.handle = await self._adapter.subscribe_live(desired)
                status.state = "live"
                status.subscribed_at = utc_now_iso()
            except Exception as error:  # noqa: BLE001 - diagnostics must preserve adapter failures.
                status.state = "failed"
                status.error = str(error) or error.__class__.__name__

        for line_key, current in list(self._lines.items()):
            if line_key in desired_by_key:
                continue
            if current.state in {"released", "releasing"}:
                continue
            current.state = "releasing"
            current.release_requested_at = utc_now_iso()
            try:
                if current.handle:
                    await self._adapter.cancel_live(current.handle)
                current.state = "released"
                del self._lines[line_key]
            except Exception as error:  # noqa: BLE001 - diagnostics must preserve adapter failures.
                current.state = "failed"
                current.error = str(error) or error.__class__.__name__

        self.applied_generation_id = generation.generation_id
        return self.lines

    def status_summary(self) -> dict[str, int | str | None]:
        lines = self.lines
        live = [line for line in lines if line.state == "live"]
        return {
            "appliedGenerationId": self.applied_generation_id,
            "lineCount": len(lines),
            "liveLineCount": len(live),
            "liveEquityLineCount": sum(1 for line in live if line.asset_class == "equity"),
            "liveOptionLineCount": sum(1 for line in live if line.asset_class == "option"),
            "subscribingLineCount": sum(1 for line in lines if line.state == "subscribing"),
            "releasingLineCount": sum(1 for line in lines if line.state == "releasing"),
            "failedLineCount": sum(1 for line in lines if line.state == "failed"),
        }
