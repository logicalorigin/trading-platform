from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

OptionRight = Literal["call", "put"]

MIN_VOLATILITY = 0.0001
MAX_VOLATILITY = 5.0


@dataclass(frozen=True)
class BlackScholesResult:
    price: float
    delta: float
    gamma: float
    theta: float
    vega: float


def black_scholes(
    *,
    spot: float,
    strike: float,
    time_to_expiration_years: float,
    volatility: float,
    right: OptionRight,
    risk_free_rate: float = 0.0,
    dividend_yield: float = 0.0,
) -> BlackScholesResult:
    _validate_inputs(
        spot=spot,
        strike=strike,
        time_to_expiration_years=time_to_expiration_years,
        volatility=volatility,
        risk_free_rate=risk_free_rate,
        dividend_yield=dividend_yield,
    )
    years = max(time_to_expiration_years, 0.0)
    if years == 0 or volatility <= 0:
        return _deterministic_result(
            spot=spot,
            strike=strike,
            time_to_expiration_years=years,
            right=right,
            risk_free_rate=risk_free_rate,
            dividend_yield=dividend_yield,
        )

    sqrt_years = math.sqrt(years)
    d1 = (
        math.log(spot / strike)
        + (risk_free_rate - dividend_yield + 0.5 * volatility * volatility) * years
    ) / (volatility * sqrt_years)
    d2 = d1 - volatility * sqrt_years
    discounted_spot = spot * math.exp(-dividend_yield * years)
    discounted_strike = strike * math.exp(-risk_free_rate * years)
    pdf_d1 = normal_pdf(d1)

    if right == "put":
        price = discounted_strike * normal_cdf(-d2) - discounted_spot * normal_cdf(-d1)
        delta = math.exp(-dividend_yield * years) * (normal_cdf(d1) - 1)
        theta_annual = (
            -(discounted_spot * pdf_d1 * volatility) / (2 * sqrt_years)
            + risk_free_rate * discounted_strike * normal_cdf(-d2)
            - dividend_yield * discounted_spot * normal_cdf(-d1)
        )
    else:
        price = discounted_spot * normal_cdf(d1) - discounted_strike * normal_cdf(d2)
        delta = math.exp(-dividend_yield * years) * normal_cdf(d1)
        theta_annual = (
            -(discounted_spot * pdf_d1 * volatility) / (2 * sqrt_years)
            - risk_free_rate * discounted_strike * normal_cdf(d2)
            + dividend_yield * discounted_spot * normal_cdf(d1)
        )

    gamma = math.exp(-dividend_yield * years) * pdf_d1 / (spot * volatility * sqrt_years)
    vega = discounted_spot * pdf_d1 * sqrt_years / 100
    return BlackScholesResult(
        price=max(0.0, price),
        delta=delta,
        gamma=gamma,
        theta=theta_annual / 365,
        vega=vega,
    )


def black_scholes_price(
    *,
    spot: float,
    strike: float,
    time_to_expiration_years: float,
    volatility: float,
    right: OptionRight,
    risk_free_rate: float = 0.0,
    dividend_yield: float = 0.0,
) -> float:
    return black_scholes(
        spot=spot,
        strike=strike,
        time_to_expiration_years=time_to_expiration_years,
        volatility=volatility,
        right=right,
        risk_free_rate=risk_free_rate,
        dividend_yield=dividend_yield,
    ).price


def implied_volatility_from_price(
    *,
    spot: float,
    strike: float,
    time_to_expiration_years: float,
    option_price: float,
    right: OptionRight,
    risk_free_rate: float = 0.0,
    dividend_yield: float = 0.0,
    min_volatility: float = MIN_VOLATILITY,
    max_volatility: float = MAX_VOLATILITY,
) -> float | None:
    if (
        not _finite_positive(spot)
        or not _finite_positive(strike)
        or not _finite_positive(option_price)
        or not math.isfinite(time_to_expiration_years)
        or time_to_expiration_years <= 0
    ):
        return None

    low_price = black_scholes_price(
        spot=spot,
        strike=strike,
        time_to_expiration_years=time_to_expiration_years,
        volatility=min_volatility,
        right=right,
        risk_free_rate=risk_free_rate,
        dividend_yield=dividend_yield,
    )
    high_price = black_scholes_price(
        spot=spot,
        strike=strike,
        time_to_expiration_years=time_to_expiration_years,
        volatility=max_volatility,
        right=right,
        risk_free_rate=risk_free_rate,
        dividend_yield=dividend_yield,
    )
    if not math.isfinite(low_price) or not math.isfinite(high_price):
        return None
    if option_price <= low_price:
        return min_volatility
    if option_price >= high_price:
        return max_volatility

    low = min_volatility
    high = max_volatility
    for _ in range(64):
        mid = (low + high) / 2
        price = black_scholes_price(
            spot=spot,
            strike=strike,
            time_to_expiration_years=time_to_expiration_years,
            volatility=mid,
            right=right,
            risk_free_rate=risk_free_rate,
            dividend_yield=dividend_yield,
        )
        if price < option_price:
            low = mid
        else:
            high = mid
    return (low + high) / 2


def normal_pdf(value: float) -> float:
    return math.exp(-0.5 * value * value) / math.sqrt(2 * math.pi)


def normal_cdf(value: float) -> float:
    return 0.5 * (1 + math.erf(value / math.sqrt(2)))


def _validate_inputs(
    *,
    spot: float,
    strike: float,
    time_to_expiration_years: float,
    volatility: float,
    risk_free_rate: float,
    dividend_yield: float,
) -> None:
    if not _finite_positive(spot):
        raise ValueError("spot must be a positive finite number")
    if not _finite_positive(strike):
        raise ValueError("strike must be a positive finite number")
    if not math.isfinite(time_to_expiration_years) or time_to_expiration_years < 0:
        raise ValueError("time_to_expiration_years must be a non-negative finite number")
    if not math.isfinite(volatility) or volatility < 0:
        raise ValueError("volatility must be a non-negative finite number")
    if not math.isfinite(risk_free_rate):
        raise ValueError("risk_free_rate must be finite")
    if not math.isfinite(dividend_yield):
        raise ValueError("dividend_yield must be finite")


def _deterministic_result(
    *,
    spot: float,
    strike: float,
    time_to_expiration_years: float,
    right: OptionRight,
    risk_free_rate: float,
    dividend_yield: float,
) -> BlackScholesResult:
    years = max(time_to_expiration_years, 0.0)
    forward = spot * math.exp((risk_free_rate - dividend_yield) * years)
    discounted_payoff = math.exp(-risk_free_rate * years)
    if right == "put":
        price = discounted_payoff * max(strike - forward, 0.0)
        delta = -math.exp(-dividend_yield * years) if forward < strike else 0.0
    else:
        price = discounted_payoff * max(forward - strike, 0.0)
        delta = math.exp(-dividend_yield * years) if forward > strike else 0.0
    return BlackScholesResult(price=price, delta=delta, gamma=0.0, theta=0.0, vega=0.0)


def _finite_positive(value: float) -> bool:
    return math.isfinite(value) and value > 0
