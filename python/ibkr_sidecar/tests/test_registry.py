from __future__ import annotations

import asyncio
import unittest

from pyrus_ibkr_sidecar.registry import (
    DesiredGeneration,
    DesiredLine,
    IbkrMarketDataAdapter,
    LineOwner,
    MarketDataRegistry,
    SubscriptionHandle,
)


class FakeAdapter(IbkrMarketDataAdapter):
    def __init__(self) -> None:
        self.subscribe_started = asyncio.Event()
        self.release_subscription = asyncio.Event()
        self.cancelled: list[str] = []

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        self.subscribe_started.set()
        await self.release_subscription.wait()
        return SubscriptionHandle(line_key=line.line_key, contract=object(), ticker=object())

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        self.cancelled.append(handle.line_key)


class CountingAdapter(IbkrMarketDataAdapter):
    def __init__(self) -> None:
        self.started = 0
        self.active = 0
        self.max_active = 0
        self.release_subscription = asyncio.Event()

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        self.started += 1
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            await self.release_subscription.wait()
            return SubscriptionHandle(
                line_key=line.line_key,
                contract=object(),
                ticker=object(),
            )
        finally:
            self.active -= 1

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        return None


def desired_generation(*lines: DesiredLine) -> DesiredGeneration:
    return DesiredGeneration(
        generation_id="test-generation",
        generated_at="2026-06-09T00:00:00Z",
        desired_lines=lines,
    )


def desired_line(line_key: str = "equity:SPY") -> DesiredLine:
    return DesiredLine(
        line_key=line_key,
        asset_class="equity",
        symbol="SPY",
        provider_contract_id=None,
        intent="visible-live",
        owners=(
            LineOwner(
                owner="test-owner",
                owner_class="visible",
                intent="visible-live",
                pool="visible",
                priority=100,
            ),
        ),
        priority=100,
    )


class MarketDataRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_apply_generation_returns_before_subscription_finishes(self) -> None:
        adapter = FakeAdapter()
        registry = MarketDataRegistry(adapter)

        apply_task = asyncio.create_task(
            registry.apply_generation(desired_generation(desired_line()))
        )
        done, _pending = await asyncio.wait({apply_task}, timeout=0.05)

        self.assertIn(apply_task, done)
        self.assertTrue(adapter.subscribe_started.is_set())
        self.assertEqual(registry.applied_generation_id, "test-generation")
        self.assertEqual(registry.lines[0].state, "subscribing")

        adapter.release_subscription.set()
        await asyncio.wait_for(self._wait_for_state(registry, "equity:SPY", "live"), 1)

    async def test_release_generation_returns_before_cancel_finishes(self) -> None:
        adapter = FakeAdapter()
        registry = MarketDataRegistry(adapter)

        await registry.apply_generation(desired_generation(desired_line()))
        adapter.release_subscription.set()
        await asyncio.wait_for(self._wait_for_state(registry, "equity:SPY", "live"), 1)

        lines = await registry.apply_generation(desired_generation())

        self.assertEqual(lines[0].state, "releasing")
        await asyncio.wait_for(self._wait_for_line_count(registry, 0), 1)
        self.assertEqual(adapter.cancelled, ["equity:SPY"])

    async def test_generation_subscribe_work_is_bounded(self) -> None:
        adapter = CountingAdapter()
        registry = MarketDataRegistry(adapter, max_concurrent_adapter_calls=2)

        await registry.apply_generation(
            desired_generation(
                *(desired_line(f"equity:TEST{i}") for i in range(5)),
            )
        )
        await asyncio.sleep(0.05)

        self.assertEqual(adapter.started, 2)
        self.assertEqual(adapter.max_active, 2)

        adapter.release_subscription.set()
        await asyncio.wait_for(self._wait_for_line_count(registry, 5), 1)
        self.assertTrue(all(line.state == "live" for line in registry.lines))

    async def _wait_for_state(
        self,
        registry: MarketDataRegistry,
        line_key: str,
        state: str,
    ) -> None:
        while True:
            if any(line.line_key == line_key and line.state == state for line in registry.lines):
                return
            await asyncio.sleep(0.01)

    async def _wait_for_line_count(
        self,
        registry: MarketDataRegistry,
        count: int,
    ) -> None:
        while True:
            if len(registry.lines) == count:
                return
            await asyncio.sleep(0.01)


if __name__ == "__main__":
    unittest.main()
