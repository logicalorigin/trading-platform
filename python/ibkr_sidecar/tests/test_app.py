from __future__ import annotations

from fastapi.testclient import TestClient

from pyrus_ibkr_sidecar.app import create_app
from pyrus_ibkr_sidecar.registry import DesiredLine, MarketDataRegistry, SubscriptionHandle


class FakeAdapter:
    def __init__(self) -> None:
        self.subscribed: list[str] = []
        self.cancelled: list[str] = []

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        self.subscribed.append(line.line_key)
        return SubscriptionHandle(
            line_key=line.line_key,
            contract={"lineKey": line.line_key},
            ticker={"lineKey": line.line_key},
        )

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        self.cancelled.append(handle.line_key)


def generation_payload(generation_id: str, *line_keys: str) -> dict[str, object]:
    desired_lines: list[dict[str, object]] = []
    for line_key in line_keys:
        asset_class = "option" if line_key.startswith("option:") else "equity"
        raw_key = line_key.split(":", 1)[1]
        desired_lines.append(
            {
                "lineKey": line_key,
                "assetClass": asset_class,
                "contract": {
                    "symbol": "SPY" if asset_class == "option" else raw_key,
                    "providerContractId": raw_key if asset_class == "option" else None,
                },
                "intent": "visible-live",
                "owners": [
                    {
                        "owner": "watchlist",
                        "ownerClass": "visible",
                        "intent": "visible-live",
                        "pool": "visible",
                        "priority": 80,
                    }
                ],
                "priority": 80,
                "reason": "test",
            }
        )
    return {
        "schemaVersion": 1,
        "generationId": generation_id,
        "source": "api-market-data-work-planner",
        "generatedAt": "2026-06-02T15:00:00.000Z",
        "desiredLines": desired_lines,
        "summary": {
            "desiredLineCount": len(desired_lines),
            "desiredEquityLineCount": sum(
                1 for line in desired_lines if line["assetClass"] == "equity"
            ),
            "desiredOptionLineCount": sum(
                1 for line in desired_lines if line["assetClass"] == "option"
            ),
            "ownerCount": 1 if desired_lines else 0,
        },
    }


def test_health_reports_empty_registry() -> None:
    client = TestClient(create_app(MarketDataRegistry(FakeAdapter())))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert response.json()["service"] == "pyrus-ibkr-sidecar"
    assert response.json()["liveLineCount"] == 0


def test_apply_generation_returns_status_and_cancels_removed_lines() -> None:
    adapter = FakeAdapter()
    client = TestClient(create_app(MarketDataRegistry(adapter)))

    first = client.post(
        "/market-data/generation",
        json=generation_payload("gen-1", "equity:AAPL", "option:twsopt:one"),
    )
    assert first.status_code == 200
    assert first.json()["mode"] == "executor"
    assert first.json()["appliedGenerationId"] == "gen-1"
    assert first.json()["summary"]["liveLineCount"] == 2
    assert first.json()["summary"]["liveOptionLineCount"] == 1
    assert adapter.subscribed == ["equity:AAPL", "option:twsopt:one"]

    second = client.post(
        "/market-data/generation",
        json=generation_payload("gen-2", "equity:AAPL"),
    )
    assert second.status_code == 200
    assert second.json()["summary"]["liveLineCount"] == 1
    assert second.json()["lines"][0]["lineKey"] == "equity:AAPL"
    assert adapter.cancelled == ["option:twsopt:one"]


def test_generation_payload_validation_rejects_wrong_schema_version() -> None:
    client = TestClient(create_app(MarketDataRegistry(FakeAdapter())))
    payload = generation_payload("gen-1", "equity:AAPL")
    payload["schemaVersion"] = 2

    response = client.post("/market-data/generation", json=payload)

    assert response.status_code == 422
