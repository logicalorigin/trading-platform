from __future__ import annotations

import asyncio
import base64
import json
import math
import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from importlib import import_module
from typing import Any, Literal, Protocol, cast

from .registry import DesiredLine, SubscriptionHandle

STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX = "twsopt:"
OptionRight = Literal["C", "P"]


@dataclass(frozen=True)
class IbAsyncAdapterConfig:
    option_generic_ticks: str = "100,101,106"
    stock_exchange: str = "SMART"
    currency: str = "USD"


@dataclass(frozen=True)
class IbAsyncConnectionConfig:
    host: str = "127.0.0.1"
    port: int = 7497
    client_id: int = 1
    connect_timeout: float = 4.0
    readonly: bool = False
    market_data_type: int | None = 1


@dataclass(frozen=True)
class StructuredOptionContract:
    symbol: str
    last_trade_date_or_contract_month: str
    strike: float
    right: OptionRight
    exchange: str
    trading_class: str | None
    multiplier: str


class IbAsyncClient(Protocol):
    async def qualifyContractsAsync(self, *contracts: object) -> list[object]: ...

    def reqMktData(
        self,
        contract: object,
        genericTickList: str = "",
        snapshot: bool = False,
        regulatorySnapshot: bool = False,
    ) -> object: ...

    def cancelMktData(self, contract: object) -> bool: ...


class IbAsyncConnectionClient(IbAsyncClient, Protocol):
    def connect(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,
        clientId: int = 1,
        timeout: float = 4,
        readonly: bool = False,
    ) -> object: ...

    async def connectAsync(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,
        clientId: int = 1,
        timeout: float = 4,
        readonly: bool = False,
    ) -> object: ...

    def reqMarketDataType(self, marketDataType: int) -> object: ...


class IbAsyncModule(Protocol):
    IB: Callable[[], IbAsyncConnectionClient]
    Stock: Callable[[str, str, str], object]
    Option: Callable[..., object]


def _normalize_symbol(value: str) -> str:
    normalized = value.strip().upper()
    if re.fullmatch(r"[A-Z]{1,5}[ -][A-Z]{1,2}", normalized):
        return re.sub(r"[ -]", ".", normalized, count=1)
    return normalized


def _payload_string(payload: dict[str, Any], key: str) -> str | None:
    value = payload.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else None


def _payload_float(payload: dict[str, Any], key: str) -> float | None:
    value = payload.get(key)
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int | float):
        parsed = float(value)
    elif isinstance(value, str):
        try:
            parsed = float(value.strip())
        except ValueError:
            return None
    else:
        return None
    return parsed if math.isfinite(parsed) else None


def _normalize_multiplier(payload: dict[str, Any]) -> str:
    multiplier = _payload_float(payload, "m")
    if multiplier is None or multiplier <= 0:
        multiplier = 100.0
    return str(int(multiplier)) if multiplier.is_integer() else str(multiplier)


def _decode_base64url_json(value: str) -> dict[str, Any]:
    padded = value + ("=" * (-len(value) % 4))
    decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
    payload = json.loads(decoded)
    if not isinstance(payload, dict):
        raise ValueError("Structured option providerContractId payload must be an object.")
    return cast(dict[str, Any], payload)


def decode_structured_option_provider_contract_id(
    provider_contract_id: str,
) -> StructuredOptionContract:
    raw = provider_contract_id.strip()
    if not raw.startswith(STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX):
        raise ValueError("Option providerContractId must use the twsopt structured format.")

    try:
        payload = _decode_base64url_json(
            raw[len(STRUCTURED_OPTION_PROVIDER_CONTRACT_ID_PREFIX) :]
        )
    except Exception as error:
        raise ValueError("Option providerContractId contains invalid structured data.") from error

    if payload.get("v") != 1:
        raise ValueError("Option providerContractId uses an unsupported structured version.")

    symbol = _normalize_symbol(_payload_string(payload, "u") or "")
    expiry = _payload_string(payload, "e") or ""
    strike = _payload_float(payload, "s")
    right = (_payload_string(payload, "r") or "").upper()
    exchange = _normalize_symbol(_payload_string(payload, "x") or "") or "SMART"
    trading_class = _normalize_symbol(_payload_string(payload, "tc") or "") or None

    if not symbol:
        raise ValueError("Option providerContractId is missing the underlying symbol.")
    if not re.fullmatch(r"\d{8}", expiry):
        raise ValueError("Option providerContractId is missing a YYYYMMDD expiry.")
    if strike is None:
        raise ValueError("Option providerContractId is missing a numeric strike.")
    if right not in {"C", "P"}:
        raise ValueError("Option providerContractId is missing a C/P right.")

    return StructuredOptionContract(
        symbol=symbol,
        last_trade_date_or_contract_month=expiry,
        strike=strike,
        right=cast(OptionRight, right),
        exchange=exchange,
        trading_class=trading_class,
        multiplier=_normalize_multiplier(payload),
    )


class IbAsyncMarketDataAdapter:
    """Thin adapter over ib_async; PYRUS allocation policy stays in the registry."""

    def __init__(self, ib: IbAsyncClient, config: IbAsyncAdapterConfig | None = None) -> None:
        self._ib = ib
        self._config = config or IbAsyncAdapterConfig()

    def _contract_for_line(self, line: DesiredLine) -> object:
        if line.asset_class == "equity":
            if not line.symbol:
                raise ValueError(f"Equity line {line.line_key} is missing a symbol.")
            ib_async = cast(IbAsyncModule, import_module("ib_async"))

            return ib_async.Stock(line.symbol, self._config.stock_exchange, self._config.currency)

        if not line.provider_contract_id:
            raise ValueError(f"Option line {line.line_key} is missing providerContractId.")

        option_contract = decode_structured_option_provider_contract_id(
            line.provider_contract_id
        )
        ib_async = cast(IbAsyncModule, import_module("ib_async"))
        kwargs: dict[str, str] = {}
        if option_contract.trading_class:
            kwargs["tradingClass"] = option_contract.trading_class

        return ib_async.Option(
            option_contract.symbol,
            option_contract.last_trade_date_or_contract_month,
            option_contract.strike,
            option_contract.right,
            option_contract.exchange,
            option_contract.multiplier,
            self._config.currency,
            **kwargs,
        )

    def _is_hashable_contract(self, contract: object) -> bool:
        is_hashable = getattr(contract, "isHashable", None)
        if callable(is_hashable):
            return bool(is_hashable())

        con_id = getattr(contract, "conId", None)
        if con_id is not None:
            return bool(con_id)

        # Unit-test fakes and non-ib_async contracts do not expose conId semantics.
        return True

    async def _qualify_contract(self, contract: object, asset_class: str) -> object:
        qualified_contracts = await self._ib.qualifyContractsAsync(contract)
        qualified_contract = qualified_contracts[0] if qualified_contracts else None
        if qualified_contract is None or isinstance(qualified_contract, list):
            raise ValueError(f"IBKR did not uniquely qualify the {asset_class} contract.")
        if not self._is_hashable_contract(qualified_contract):
            raise ValueError(
                f"IBKR returned an unqualified {asset_class} contract without conId."
            )
        return qualified_contract

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        contract = self._contract_for_line(line)
        generic_ticks = (
            self._config.option_generic_ticks if line.asset_class == "option" else ""
        )
        contract = await self._qualify_contract(contract, line.asset_class)
        ticker = self._ib.reqMktData(
            contract,
            genericTickList=generic_ticks,
            snapshot=False,
            regulatorySnapshot=False,
        )
        return SubscriptionHandle(line_key=line.line_key, contract=contract, ticker=ticker)

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        self._ib.cancelMktData(handle.contract)


def _read_int_env(name: str, fallback: int) -> int:
    try:
        return int(os.environ.get(name, str(fallback)))
    except ValueError:
        return fallback


def _read_float_env(name: str, fallback: float) -> float:
    try:
        return float(os.environ.get(name, str(fallback)))
    except ValueError:
        return fallback


def _read_bool_env(name: str, fallback: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return fallback
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class LazyIbAsyncMarketDataAdapter:
    def __init__(
        self,
        adapter_config: IbAsyncAdapterConfig | None = None,
        connection_config: IbAsyncConnectionConfig | None = None,
    ) -> None:
        self._adapter_config = adapter_config or IbAsyncAdapterConfig()
        self._connection_config = connection_config or IbAsyncConnectionConfig()
        self._delegate: IbAsyncMarketDataAdapter | None = None
        self._connect_lock = asyncio.Lock()

    @classmethod
    def from_env(cls) -> LazyIbAsyncMarketDataAdapter:
        market_data_type = _read_int_env("PYRUS_IBKR_SIDECAR_MARKET_DATA_TYPE", 1)
        return cls(
            adapter_config=IbAsyncAdapterConfig(
                option_generic_ticks=os.environ.get(
                    "PYRUS_IBKR_SIDECAR_OPTION_GENERIC_TICKS",
                    "100,101,106",
                ),
                stock_exchange=os.environ.get("PYRUS_IBKR_SIDECAR_STOCK_EXCHANGE", "SMART"),
                currency=os.environ.get("PYRUS_IBKR_SIDECAR_CURRENCY", "USD"),
            ),
            connection_config=IbAsyncConnectionConfig(
                host=os.environ.get("PYRUS_IBKR_SIDECAR_IB_HOST", "127.0.0.1"),
                port=_read_int_env("PYRUS_IBKR_SIDECAR_IB_PORT", 7497),
                client_id=_read_int_env("PYRUS_IBKR_SIDECAR_CLIENT_ID", 1),
                connect_timeout=_read_float_env("PYRUS_IBKR_SIDECAR_CONNECT_TIMEOUT", 4.0),
                readonly=_read_bool_env("PYRUS_IBKR_SIDECAR_READONLY", False),
                market_data_type=market_data_type if market_data_type > 0 else None,
            ),
        )

    async def _ensure_delegate(self) -> IbAsyncMarketDataAdapter:
        delegate = self._delegate
        if delegate is not None:
            return delegate

        async with self._connect_lock:
            delegate = self._delegate
            if delegate is not None:
                return delegate

            ib_async = cast(IbAsyncModule, import_module("ib_async"))
            ib = ib_async.IB()
            await ib.connectAsync(
                self._connection_config.host,
                self._connection_config.port,
                clientId=self._connection_config.client_id,
                timeout=self._connection_config.connect_timeout,
                readonly=self._connection_config.readonly,
            )
            if self._connection_config.market_data_type is not None:
                ib.reqMarketDataType(self._connection_config.market_data_type)
            self._delegate = IbAsyncMarketDataAdapter(ib, self._adapter_config)
        return self._delegate

    async def subscribe_live(self, line: DesiredLine) -> SubscriptionHandle:
        return await (await self._ensure_delegate()).subscribe_live(line)

    async def cancel_live(self, handle: SubscriptionHandle) -> None:
        await (await self._ensure_delegate()).cancel_live(handle)
