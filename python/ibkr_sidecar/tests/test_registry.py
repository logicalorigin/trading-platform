from __future__ import annotations

import asyncio
from dataclasses import dataclass

from pyrus_ibkr_sidecar.registry import (
    DesiredGeneration,
    DesiredLine,
    LineOwner,
    MarketDataRegistry,
    SubscriptionHandle,
)


@dataclass
class FakeAdapter:
    subscribed: list[str]
    cancelled: list[str]

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        self.subscribed.append(line.line_key)
        return SubscriptionHandle(
            line_key=line.line_key,
            contract={"lineKey": line.line_key},
            ticker={"lineKey": line.line_key},
        )

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        self.cancelled.append(handle.line_key)


def owner(name: str, priority: int = 80) -> LineOwner:
    return LineOwner(
        owner=name,
        owner_class="visible",
        intent="visible-live",
        pool="visible",
        priority=priority,
    )


def line(line_key: str, *owners: LineOwner) -> DesiredLine:
    asset_class = "option" if line_key.startswith("option:") else "equity"
    return DesiredLine(
        line_key=line_key,
        asset_class=asset_class,
        symbol="SPY" if asset_class == "option" else line_key.split(":", 1)[1],
        provider_contract_id=line_key.split(":", 1)[1] if asset_class == "option" else None,
        intent=owners[0].intent if owners else "visible-live",
        owners=owners,
        priority=max((entry.priority or 0 for entry in owners), default=0),
    )


def generation(generation_id: str, *lines: DesiredLine) -> DesiredGeneration:
    return DesiredGeneration(
        generation_id=generation_id,
        generated_at="2026-06-02T15:00:00.000Z",
        desired_lines=lines,
    )


def test_apply_generation_subscribes_each_line_once() -> None:
    adapter = FakeAdapter(subscribed=[], cancelled=[])
    registry = MarketDataRegistry(adapter)

    asyncio.run(
        registry.apply_generation(
            generation(
                "gen-1",
                line("equity:AAPL", owner("watchlist"), owner("account")),
                line("option:twsopt:one", owner("scanner", 55)),
            )
        )
    )

    assert adapter.subscribed == ["equity:AAPL", "option:twsopt:one"]
    assert adapter.cancelled == []
    assert registry.status_summary()["liveLineCount"] == 2
    assert registry.status_summary()["liveEquityLineCount"] == 1
    assert registry.status_summary()["liveOptionLineCount"] == 1


def test_owner_update_reuses_existing_subscription() -> None:
    adapter = FakeAdapter(subscribed=[], cancelled=[])
    registry = MarketDataRegistry(adapter)

    asyncio.run(
        registry.apply_generation(
            generation("gen-1", line("equity:AAPL", owner("watchlist")))
        )
    )
    asyncio.run(
        registry.apply_generation(
            generation("gen-2", line("equity:AAPL", owner("watchlist"), owner("account")))
        )
    )

    assert adapter.subscribed == ["equity:AAPL"]
    assert adapter.cancelled == []
    status = registry.lines[0]
    assert status.line_key == "equity:AAPL"
    assert sorted(entry.owner for entry in status.owners) == ["account", "watchlist"]


def test_generation_drop_cancels_removed_line() -> None:
    adapter = FakeAdapter(subscribed=[], cancelled=[])
    registry = MarketDataRegistry(adapter)

    asyncio.run(
        registry.apply_generation(
            generation(
                "gen-1",
                line("equity:AAPL", owner("watchlist")),
                line("equity:MSFT", owner("watchlist")),
            )
        )
    )
    asyncio.run(
        registry.apply_generation(
            generation("gen-2", line("equity:AAPL", owner("watchlist")))
        )
    )

    assert adapter.subscribed == ["equity:AAPL", "equity:MSFT"]
    assert adapter.cancelled == ["equity:MSFT"]
    assert [status.line_key for status in registry.lines] == ["equity:AAPL"]
