from __future__ import annotations

import asyncio
import base64
import json
import sys
from dataclasses import dataclass
from types import SimpleNamespace

import pytest

from pyrus_ibkr_sidecar.ib_async_adapter import (
    IbAsyncConnectionConfig,
    IbAsyncMarketDataAdapter,
    LazyIbAsyncMarketDataAdapter,
    decode_structured_option_provider_contract_id,
)
from pyrus_ibkr_sidecar.registry import DesiredLine, LineOwner


def structured_provider_contract_id(payload: dict[str, object]) -> str:
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    )
    return f"twsopt:{encoded.decode('ascii').rstrip('=')}"


def desired_option_line(provider_contract_id: str) -> DesiredLine:
    return DesiredLine(
        line_key=f"option:{provider_contract_id}",
        asset_class="option",
        symbol="SPY",
        provider_contract_id=provider_contract_id,
        intent="visible-live",
        owners=(
            LineOwner(
                owner="test",
                owner_class="visible",
                intent="visible-live",
                pool="visible",
                priority=80,
            ),
        ),
        priority=80,
    )


def desired_equity_line(symbol: str) -> DesiredLine:
    return DesiredLine(
        line_key=f"equity:{symbol}",
        asset_class="equity",
        symbol=symbol,
        provider_contract_id=None,
        intent="visible-live",
        owners=(
            LineOwner(
                owner="test",
                owner_class="visible",
                intent="visible-live",
                pool="visible",
                priority=80,
            ),
        ),
        priority=80,
    )


@dataclass(frozen=True)
class FakeContract:
    args: tuple[object, ...]
    kwargs: dict[str, object]


class FakeIb:
    def __init__(self) -> None:
        self.requests: list[dict[str, object]] = []
        self.cancelled: list[object] = []
        self.connect_async_calls: list[dict[str, object]] = []
        self.market_data_types: list[int] = []
        self.qualify_async_calls: list[tuple[object, ...]] = []
        self.qualified_contracts: list[object | list[object] | None] = []

    def connect(self, *_args: object, **_kwargs: object) -> object:
        raise AssertionError("synchronous connect must not be used in the sidecar server")

    async def connectAsync(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,
        clientId: int = 1,
        timeout: float = 4,
        readonly: bool = False,
    ) -> object:
        self.connect_async_calls.append(
            {
                "host": host,
                "port": port,
                "clientId": clientId,
                "timeout": timeout,
                "readonly": readonly,
            }
        )
        return object()

    def reqMarketDataType(self, marketDataType: int) -> object:
        self.market_data_types.append(marketDataType)
        return object()

    async def qualifyContractsAsync(
        self,
        *contracts: object,
    ) -> list[object | list[object] | None]:
        self.qualify_async_calls.append(contracts)
        return self.qualified_contracts or list(contracts)

    def reqMktData(
        self,
        contract: object,
        genericTickList: str = "",
        snapshot: bool = False,
        regulatorySnapshot: bool = False,
    ) -> object:
        self.requests.append(
            {
                "contract": contract,
                "genericTickList": genericTickList,
                "snapshot": snapshot,
                "regulatorySnapshot": regulatorySnapshot,
            }
        )
        return {"ticker": len(self.requests)}

    def cancelMktData(self, contract: object) -> bool:
        self.cancelled.append(contract)
        return True


def fake_contract(*args: object, **kwargs: object) -> FakeContract:
    return FakeContract(args=args, kwargs=kwargs)


@dataclass(frozen=True)
class FakeIbAsyncContract:
    conId: int = 0

    def isHashable(self) -> bool:
        return bool(self.conId)


def test_decode_structured_option_provider_contract_id() -> None:
    provider_contract_id = structured_provider_contract_id(
        {
            "v": 1,
            "u": "spy",
            "e": "20260619",
            "s": 500,
            "r": "C",
            "x": "smart",
            "tc": "SPY",
            "m": 100,
        }
    )

    decoded = decode_structured_option_provider_contract_id(provider_contract_id)

    assert decoded.symbol == "SPY"
    assert decoded.last_trade_date_or_contract_month == "20260619"
    assert decoded.strike == 500
    assert decoded.right == "C"
    assert decoded.exchange == "SMART"
    assert decoded.trading_class == "SPY"
    assert decoded.multiplier == "100"


def test_adapter_builds_ib_async_option_contract(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_contract_id = structured_provider_contract_id(
        {
            "v": 1,
            "u": "SPY",
            "e": "20260619",
            "s": 500,
            "r": "C",
            "x": "SMART",
            "tc": "SPY",
            "m": 100,
        }
    )
    monkeypatch.setitem(
        sys.modules,
        "ib_async",
        SimpleNamespace(Stock=fake_contract, Option=fake_contract),
    )
    fake_ib = FakeIb()
    qualified_contract = FakeContract(args=("qualified",), kwargs={"conId": 123})
    fake_ib.qualified_contracts = [qualified_contract]
    adapter = IbAsyncMarketDataAdapter(fake_ib)

    handle = asyncio.run(adapter.subscribe_live(desired_option_line(provider_contract_id)))

    request = fake_ib.requests[0]
    raw_contract = fake_ib.qualify_async_calls[0][0]
    assert isinstance(raw_contract, FakeContract)
    assert raw_contract.args == ("SPY", "20260619", 500.0, "C", "SMART", "100", "USD")
    assert raw_contract.kwargs == {"tradingClass": "SPY"}
    assert request["contract"] is qualified_contract
    assert request["genericTickList"] == "100,101,106"
    assert handle.contract is qualified_contract


def test_adapter_rejects_option_when_qualification_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_contract_id = structured_provider_contract_id(
        {
            "v": 1,
            "u": "SPY",
            "e": "20260619",
            "s": 500,
            "r": "C",
            "x": "SMART",
            "tc": "SPY",
            "m": 100,
        }
    )
    monkeypatch.setitem(
        sys.modules,
        "ib_async",
        SimpleNamespace(Stock=fake_contract, Option=fake_contract),
    )
    fake_ib = FakeIb()
    fake_ib.qualified_contracts = [None]
    adapter = IbAsyncMarketDataAdapter(fake_ib)

    with pytest.raises(ValueError, match="did not uniquely qualify"):
        asyncio.run(adapter.subscribe_live(desired_option_line(provider_contract_id)))

    assert fake_ib.requests == []


def test_adapter_rejects_unqualified_option_without_con_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    provider_contract_id = structured_provider_contract_id(
        {
            "v": 1,
            "u": "SPY",
            "e": "20260619",
            "s": 500,
            "r": "C",
            "x": "SMART",
            "tc": "SPY",
            "m": 100,
        }
    )
    monkeypatch.setitem(
        sys.modules,
        "ib_async",
        SimpleNamespace(Stock=fake_contract, Option=fake_contract),
    )
    fake_ib = FakeIb()
    fake_ib.qualified_contracts = [FakeIbAsyncContract(conId=0)]
    adapter = IbAsyncMarketDataAdapter(fake_ib)

    with pytest.raises(ValueError, match="without conId"):
        asyncio.run(adapter.subscribe_live(desired_option_line(provider_contract_id)))

    assert fake_ib.requests == []


def test_adapter_rejects_non_structured_option_contract_id() -> None:
    adapter = IbAsyncMarketDataAdapter(FakeIb())

    with pytest.raises(ValueError, match="twsopt structured format"):
        asyncio.run(adapter.subscribe_live(desired_option_line("123456")))


def test_lazy_adapter_uses_connect_async(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_ib = FakeIb()
    qualified_contract = FakeContract(args=("qualified-equity",), kwargs={"conId": 456})
    fake_ib.qualified_contracts = [qualified_contract]
    monkeypatch.setitem(
        sys.modules,
        "ib_async",
        SimpleNamespace(
            IB=lambda: fake_ib,
            Stock=fake_contract,
            Option=fake_contract,
        ),
    )
    adapter = LazyIbAsyncMarketDataAdapter(
        connection_config=IbAsyncConnectionConfig(
            host="10.0.0.5",
            port=4001,
            client_id=23,
            connect_timeout=1.5,
            readonly=True,
            market_data_type=3,
        ),
    )

    handle = asyncio.run(adapter.subscribe_live(desired_equity_line("AAPL")))

    assert fake_ib.connect_async_calls == [
        {
            "host": "10.0.0.5",
            "port": 4001,
            "clientId": 23,
            "timeout": 1.5,
            "readonly": True,
        }
    ]
    assert fake_ib.market_data_types == [3]
    assert len(fake_ib.requests) == 1
    raw_contract = fake_ib.qualify_async_calls[0][0]
    assert isinstance(raw_contract, FakeContract)
    assert raw_contract.args == ("AAPL", "SMART", "USD")
    assert fake_ib.requests[0]["contract"] is qualified_contract
    assert handle.line_key == "equity:AAPL"
    assert handle.contract is qualified_contract
