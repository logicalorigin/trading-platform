from __future__ import annotations

import math
import statistics
import time
from collections import defaultdict
from typing import Any, TypedDict, cast

import numpy as np

from .black_scholes import (
    MAX_VOLATILITY,
    MIN_VOLATILITY,
    OptionRight,
    black_scholes_price,
    implied_volatility_from_price,
)
from .models import (
    BenchmarkMatrixInput,
    GreekPositionInput,
    GreekScale,
    GreekScenarioMatrixInput,
    GreekScenarioPricingModel,
    JobRequest,
    JobType,
    PortfolioOptimizationInput,
    PortfolioOptimizationObjective,
    PortfolioRiskInput,
)

THETA_BURDEN_FLAG_PCT = 2.0
SHORT_GAMMA_CONVEXITY_FLAG_PCT = -5.0
VEGA_SENSITIVE_FLAG_PCT = 5.0


class NormalizedGreekPosition(TypedDict):
    symbol: str
    underlying: str
    quantity: float
    contractUnits: float
    spot: float
    markPrice: float
    strike: float | None
    right: OptionRight | None
    impliedVolatility: float | None
    daysToExpiration: float | None
    riskFreeRate: float | None
    dividendYield: float | None
    pricingModel: str
    blackScholesVolatility: float | None
    blackScholesVolatilitySource: str | None
    premiumExposure: float
    deltaShares: float
    gammaUnits: float
    thetaPerDay: float
    vegaPerVolPoint: float


def _bound_option_scenario_components(
    position: NormalizedGreekPosition,
    components: dict[str, float],
    new_spot: float,
) -> tuple[dict[str, float], bool]:
    raw_total = sum(components.values())
    lower_bound, upper_bound = _option_scenario_pnl_bounds(position, new_spot)
    if raw_total == 0:
        return components, False

    bounded_total = raw_total
    if lower_bound is not None:
        bounded_total = max(bounded_total, lower_bound)
    if upper_bound is not None:
        bounded_total = min(bounded_total, upper_bound)

    if bounded_total == raw_total:
        return components, False

    scale = bounded_total / raw_total
    return {key: value * scale for key, value in components.items()}, True


def _option_scenario_pnl_bounds(
    position: NormalizedGreekPosition,
    new_spot: float,
) -> tuple[float | None, float | None]:
    premium = position["premiumExposure"]
    quantity = position["quantity"]
    contract_units = position["contractUnits"]
    if premium <= 0 or contract_units <= 0 or quantity == 0:
        return None, None

    lower_price, upper_price = _option_price_bounds(position, new_spot)
    lower_value = lower_price * contract_units
    upper_value = None if upper_price is None else upper_price * contract_units

    if quantity > 0:
        lower_pnl = lower_value - premium
        upper_pnl = None if upper_value is None else upper_value - premium
        return lower_pnl, upper_pnl

    short_lower_pnl = None if upper_value is None else premium - upper_value
    short_upper_pnl = premium - lower_value
    return short_lower_pnl, short_upper_pnl


def _option_price_bounds(
    position: NormalizedGreekPosition,
    new_spot: float,
) -> tuple[float, float | None]:
    right = position["right"]
    strike = position["strike"]
    spot = max(new_spot, 0)
    if right == "call":
        intrinsic = max(spot - strike, 0) if strike is not None else 0
        return intrinsic, spot
    if right == "put" and strike is not None:
        return max(strike - spot, 0), strike
    return 0, None


def run_job(request: JobRequest) -> tuple[dict[str, Any], list[str]]:
    if request.jobType == JobType.BENCHMARK_MATRIX:
        return run_benchmark_matrix(BenchmarkMatrixInput.model_validate(request.input))
    if request.jobType == JobType.GREEK_SCENARIO_MATRIX:
        return run_greek_scenario_matrix(GreekScenarioMatrixInput.model_validate(request.input))
    if request.jobType == JobType.PORTFOLIO_OPTIMIZATION:
        return run_portfolio_optimization(PortfolioOptimizationInput.model_validate(request.input))
    if request.jobType == JobType.PORTFOLIO_RISK:
        return run_portfolio_risk(PortfolioRiskInput.model_validate(request.input))
    raise ValueError(f"unsupported job type: {request.jobType}")


def timed(label: str, fn: Any) -> dict[str, Any]:
    start = time.perf_counter()
    value = fn()
    duration_ms = (time.perf_counter() - start) * 1000
    return {"name": label, "durationMs": round(duration_ms, 4), "result": value}


def run_benchmark_matrix(input_data: BenchmarkMatrixInput) -> tuple[dict[str, Any], list[str]]:
    rng = np.random.default_rng(input_data.seed)
    returns = rng.normal(0.0004, 0.015, input_data.rows)
    prices = np.maximum(1, 100 * np.cumprod(1 + returns))
    deltas = rng.uniform(-1, 1, input_data.rows)
    gammas = np.abs(rng.normal(0.02, 0.01, input_data.rows))
    open_interest = rng.integers(0, 2_500, input_data.rows).astype(float)

    metrics = [
        timed(
            "account_return_series_numpy",
            lambda: {
                "lastReturnPercent": float(((prices[-1] - prices[0]) / prices[0]) * 100),
                "meanReturn": float(np.mean(np.diff(prices) / prices[:-1])),
            },
        ),
        timed(
            "backtest_monte_carlo_numpy",
            lambda: {
                "p05EndingEquity": float(
                    np.quantile(
                        100_000
                        * np.cumprod(
                            1
                            + rng.choice(returns, size=(input_data.trials * 25, 252), replace=True),
                            axis=1,
                        )[:, -1],
                        0.05,
                    )
                )
            },
        ),
        timed(
            "signal_rolling_mean_numpy",
            lambda: {
                "lastRollingMean": float(
                    np.convolve(prices, np.ones(20) / 20, mode="valid")[-1]
                )
            },
        ),
        timed(
            "option_gex_vector_numpy",
            lambda: {
                "netGex": float(
                    np.sum(
                        np.sign(deltas)
                        * gammas
                        * open_interest
                        * prices
                        * prices
                        * 0.01
                    )
                )
            },
        ),
        timed(
            "portfolio_covariance_numpy",
            lambda: {
                "trace": float(
                    np.trace(
                        np.cov(
                            rng.normal(
                                0,
                                0.02,
                                (8, min(input_data.rows, 5_000)),
                            )
                        )
                    )
                )
            },
        ),
    ]

    return {
        "rows": input_data.rows,
        "trials": input_data.trials,
        "metrics": metrics,
    }, []


def finite(value: float | None) -> bool:
    return isinstance(value, int | float) and math.isfinite(value)


def _normalize_volatility(value: float | None) -> float | None:
    if value is None or not math.isfinite(value) or value <= 0:
        return None
    # Upstream quote payloads should use decimals, but older feeds sometimes
    # express IV as a percent. Treat values over 3 as percent-style inputs.
    normalized = value / 100 if value > 3 else value
    return min(max(normalized, MIN_VOLATILITY), MAX_VOLATILITY)


def _resolve_black_scholes_volatility(
    position: GreekPositionInput,
) -> tuple[float | None, str | None]:
    direct_volatility = _normalize_volatility(position.impliedVolatility)
    if direct_volatility is not None:
        return direct_volatility, "input"

    if (
        position.strike is None
        or position.right is None
        or position.daysToExpiration is None
        or position.daysToExpiration <= 0
        or position.markPrice <= 0
    ):
        return None, None

    inferred_volatility = implied_volatility_from_price(
        spot=position.spot,
        strike=position.strike,
        time_to_expiration_years=position.daysToExpiration / 365,
        option_price=position.markPrice,
        right=position.right,
        risk_free_rate=position.riskFreeRate or 0.0,
        dividend_yield=position.dividendYield or 0.0,
    )
    if inferred_volatility is None:
        return None, None
    return inferred_volatility, "implied_from_mark"


def _can_reprice_black_scholes(position: NormalizedGreekPosition) -> bool:
    return (
        position["pricingModel"] == GreekScenarioPricingModel.BLACK_SCHOLES.value
        and position["strike"] is not None
        and position["strike"] > 0
        and position["right"] is not None
        and position["daysToExpiration"] is not None
        and position["daysToExpiration"] >= 0
        and position["quantity"] != 0
        and position["contractUnits"] > 0
        and (
            position["blackScholesVolatility"] is not None
            or position["daysToExpiration"] == 0
        )
    )


def _effective_pricing_model(
    position: GreekPositionInput,
    black_scholes_volatility: float | None,
) -> str:
    if position.pricingModel == GreekScenarioPricingModel.BOUNDED_GREEK_APPROXIMATION:
        return GreekScenarioPricingModel.BOUNDED_GREEK_APPROXIMATION.value
    if (
        position.strike is not None
        and position.strike > 0
        and position.right is not None
        and position.daysToExpiration is not None
        and position.daysToExpiration >= 0
        and position.quantity != 0
        and position.multiplier > 0
        and (black_scholes_volatility is not None or position.daysToExpiration == 0)
    ):
        return GreekScenarioPricingModel.BLACK_SCHOLES.value
    return GreekScenarioPricingModel.BOUNDED_GREEK_APPROXIMATION.value


def _black_scholes_scenario_pnl(
    position: NormalizedGreekPosition,
    *,
    spot_shock: float,
    iv_shock: float,
    day_offset: float,
) -> float:
    strike = position["strike"]
    right = position["right"]
    days_to_expiration = position["daysToExpiration"]
    if strike is None or right is None or days_to_expiration is None:
        raise ValueError("black-scholes scenario requested without complete contract data")

    spot = position["spot"]
    new_spot = max(spot * (1 + spot_shock), 0.000001)
    years = max(days_to_expiration - day_offset, 0) / 365
    base_volatility = position["blackScholesVolatility"] or MIN_VOLATILITY
    scenario_volatility = min(
        max(base_volatility + iv_shock / 100, MIN_VOLATILITY),
        MAX_VOLATILITY,
    )
    shocked_price = black_scholes_price(
        spot=new_spot,
        strike=strike,
        time_to_expiration_years=years,
        volatility=scenario_volatility,
        right=right,
        risk_free_rate=position["riskFreeRate"] or 0.0,
        dividend_yield=position["dividendYield"] or 0.0,
    )
    lower_price, upper_price = _option_price_bounds(position, new_spot)
    bounded_price = max(shocked_price, lower_price)
    if upper_price is not None:
        bounded_price = min(bounded_price, upper_price)
    signed_contract_units = math.copysign(position["contractUnits"], position["quantity"])
    return (bounded_price - position["markPrice"]) * signed_contract_units


def _scaled_greek(
    position: GreekPositionInput,
    value: float | None,
    default: float = 0,
) -> float:
    if value is None or not math.isfinite(value):
        return default
    if position.greekScale == GreekScale.POSITION:
        return value
    return value * position.quantity * position.multiplier


def _premium_exposure(position: GreekPositionInput) -> float:
    return abs(position.markPrice * position.quantity * position.multiplier)


def run_greek_scenario_matrix(
    input_data: GreekScenarioMatrixInput,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    positions = input_data.positions
    if not positions:
        return {
            "scenarioCount": 0,
            "scenarios": [],
            "positions": [],
            "managementFlags": [],
        }, ["greek_scenario_matrix received no positions"]

    normalized_positions: list[NormalizedGreekPosition] = []
    for position in positions:
        black_scholes_volatility, volatility_source = _resolve_black_scholes_volatility(position)
        effective_pricing_model = _effective_pricing_model(position, black_scholes_volatility)
        if (
            position.pricingModel == GreekScenarioPricingModel.BLACK_SCHOLES
            and black_scholes_volatility is None
            and position.daysToExpiration != 0
        ):
            warnings.append(
                f"{position.symbol} missing usable Black-Scholes volatility; "
                "using bounded Greek approximation."
            )
        missing = [
            name
            for name, value in {
                "delta": position.delta,
                "gamma": position.gamma,
                "theta": position.theta,
                "vega": position.vega,
            }.items()
            if value is None or not math.isfinite(value)
        ]
        if missing:
            warnings.append(f"{position.symbol} missing {', '.join(missing)}; using zero.")
        premium_exposure = _premium_exposure(position)
        normalized_positions.append(
            {
                "symbol": position.symbol,
                "underlying": position.underlying,
                "quantity": position.quantity,
                "contractUnits": abs(position.quantity * position.multiplier),
                "spot": position.spot,
                "markPrice": position.markPrice,
                "strike": position.strike,
                "right": position.right,
                "impliedVolatility": _normalize_volatility(position.impliedVolatility),
                "daysToExpiration": position.daysToExpiration,
                "riskFreeRate": position.riskFreeRate,
                "dividendYield": position.dividendYield,
                "pricingModel": effective_pricing_model,
                "blackScholesVolatility": black_scholes_volatility,
                "blackScholesVolatilitySource": volatility_source,
                "premiumExposure": premium_exposure,
                "deltaShares": _scaled_greek(position, position.delta),
                "gammaUnits": _scaled_greek(position, position.gamma),
                "thetaPerDay": _scaled_greek(position, position.theta),
                "vegaPerVolPoint": _scaled_greek(position, position.vega),
            }
        )

    scenario_rows: list[dict[str, Any]] = []
    bounded_position_scenario_count = 0
    repriced_position_scenario_count = 0
    fallback_position_scenario_count = 0
    for spot_shock in input_data.spotShocks:
        for iv_shock in input_data.ivShocks:
            for day_offset in input_data.dayOffsets:
                total_delta = 0.0
                total_gamma = 0.0
                total_theta = 0.0
                total_vega = 0.0
                total_repricing = 0.0
                scenario_bounded_count = 0
                scenario_repriced_count = 0
                scenario_fallback_count = 0
                for normalized_position in normalized_positions:
                    if _can_reprice_black_scholes(normalized_position):
                        total_repricing += _black_scholes_scenario_pnl(
                            normalized_position,
                            spot_shock=spot_shock,
                            iv_shock=iv_shock,
                            day_offset=day_offset,
                        )
                        scenario_repriced_count += 1
                        continue

                    spot = normalized_position["spot"]
                    d_spot = spot * spot_shock
                    raw_components = {
                        "delta": normalized_position["deltaShares"] * d_spot,
                        "gamma": 0.5 * normalized_position["gammaUnits"] * d_spot * d_spot,
                        "theta": normalized_position["thetaPerDay"] * day_offset,
                        "vega": normalized_position["vegaPerVolPoint"] * iv_shock,
                    }
                    components, bounded = _bound_option_scenario_components(
                        normalized_position,
                        raw_components,
                        spot + d_spot,
                    )
                    if bounded:
                        scenario_bounded_count += 1
                    total_delta += components["delta"]
                    total_gamma += components["gamma"]
                    total_theta += components["theta"]
                    total_vega += components["vega"]
                    scenario_fallback_count += 1

                total = total_delta + total_gamma + total_theta + total_vega + total_repricing
                bounded_position_scenario_count += scenario_bounded_count
                repriced_position_scenario_count += scenario_repriced_count
                fallback_position_scenario_count += scenario_fallback_count
                component_values: dict[str, float] = {}
                if scenario_fallback_count > 0:
                    component_values.update(
                        {
                            "delta": round(total_delta, 6),
                            "gamma": round(total_gamma, 6),
                            "theta": round(total_theta, 6),
                            "vega": round(total_vega, 6),
                        }
                    )
                if scenario_repriced_count > 0:
                    component_values["repricing"] = round(total_repricing, 6)
                scenario_rows.append(
                    {
                        "spotShock": spot_shock,
                        "ivShockVolPoints": iv_shock,
                        "dayOffset": day_offset,
                        "estimatedPnl": round(total, 6),
                        "components": component_values,
                        "boundedPositionCount": scenario_bounded_count,
                        "repricedPositionCount": scenario_repriced_count,
                        "fallbackPositionCount": scenario_fallback_count,
                    }
                )

    management_flags = _build_greek_management_flags(normalized_positions)
    pricing_model = "bounded_greek_approximation"
    if repriced_position_scenario_count > 0 and fallback_position_scenario_count > 0:
        pricing_model = "mixed"
    elif repriced_position_scenario_count > 0:
        pricing_model = "black_scholes"
    return {
        "scenarioCount": len(scenario_rows),
        "scenarios": scenario_rows,
        "positions": [
            {
                **position,
                "premiumExposure": round(float(position["premiumExposure"]), 6),
                "deltaShares": round(float(position["deltaShares"]), 6),
                "gammaUnits": round(float(position["gammaUnits"]), 6),
                "thetaPerDay": round(float(position["thetaPerDay"]), 6),
                "vegaPerVolPoint": round(float(position["vegaPerVolPoint"]), 6),
            }
            for position in normalized_positions
        ],
        "managementFlags": management_flags,
        "pricingModel": pricing_model,
        "repricedPositionScenarioCount": repriced_position_scenario_count,
        "fallbackPositionScenarioCount": fallback_position_scenario_count,
        "boundedPositionScenarioCount": bounded_position_scenario_count,
    }, warnings


def _build_greek_management_flags(
    positions: list[NormalizedGreekPosition],
) -> list[dict[str, Any]]:
    flags: list[dict[str, Any]] = []
    for position in positions:
        premium = position["premiumExposure"]
        if premium <= 0:
            continue
        symbol = position["symbol"]
        spot = position["spot"]
        theta_per_day = position["thetaPerDay"]
        gamma_units = position["gammaUnits"]
        vega_per_vol_point = position["vegaPerVolPoint"]
        theta_burden_pct = abs(theta_per_day) / premium * 100
        down_five_gamma = 0.5 * gamma_units * (spot * -0.05) ** 2
        up_five_gamma = 0.5 * gamma_units * (spot * 0.05) ** 2
        worst_gamma_pct = min(down_five_gamma, up_five_gamma) / premium * 100
        five_vol_point_vega_pct = vega_per_vol_point * 5 / premium * 100

        reasons: list[str] = []
        if theta_burden_pct >= THETA_BURDEN_FLAG_PCT:
            reasons.append("theta_burden")
        if worst_gamma_pct <= SHORT_GAMMA_CONVEXITY_FLAG_PCT:
            reasons.append("short_gamma_convexity")
        if abs(five_vol_point_vega_pct) >= VEGA_SENSITIVE_FLAG_PCT:
            reasons.append("vega_sensitive")
        if not reasons:
            continue
        severity_score = max(
            theta_burden_pct / THETA_BURDEN_FLAG_PCT,
            abs(worst_gamma_pct / SHORT_GAMMA_CONVEXITY_FLAG_PCT),
            abs(five_vol_point_vega_pct) / VEGA_SENSITIVE_FLAG_PCT,
        )
        flags.append(
            {
                "symbol": symbol,
                "reasons": reasons,
                "severityScore": round(severity_score, 6),
                "thetaBurdenPct": round(theta_burden_pct, 6),
                "worstFivePctGammaPnlPct": round(worst_gamma_pct, 6),
                "fiveVolPointVegaPnlPct": round(five_vol_point_vega_pct, 6),
            }
        )
    return sorted(flags, key=lambda flag: flag["severityScore"], reverse=True)


def run_portfolio_optimization(
    input_data: PortfolioOptimizationInput,
) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    positions = input_data.positions
    if not positions:
        warning = "portfolio_optimization received no positions"
        return {
            "advisoryOnly": True,
            "objective": input_data.objective.value,
            "allocations": [],
            "turnover": 0,
            "portfolioVariance": 0,
            "portfolioVolatility": 0,
            "concentration": {
                "maxWeight": 0,
                "topSymbol": None,
                "effectivePositionCount": 0,
            },
            "warnings": [warning],
        }, [warning]

    symbols = [position.symbol for position in positions]
    current_weights, current_warnings = _current_portfolio_weights(input_data)
    warnings.extend(current_warnings)
    covariance, covariance_warnings = _optimization_covariance(input_data, symbols)
    warnings.extend(covariance_warnings)
    expected_returns = _optimization_expected_returns(input_data, symbols)
    raw_target = _objective_weights(
        covariance,
        expected_returns,
        input_data.objective,
        warnings,
    )
    target_weights, cap_warnings = _apply_max_weight_constraint(
        raw_target,
        input_data.constraints.maxWeight,
    )
    warnings.extend(cap_warnings)
    target_weights = _apply_turnover_constraint(
        target_weights,
        current_weights,
        input_data.constraints.maxTurnover,
    )
    target_weights = _normalize_weights(target_weights)
    risk_contribution = _risk_contribution(target_weights, covariance)
    turnover = 0.5 * float(np.sum(np.abs(target_weights - current_weights)))
    portfolio_variance = max(float(target_weights @ covariance @ target_weights), 0.0)
    max_index = int(np.argmax(target_weights))
    allocations = [
        {
            "symbol": symbol,
            "currentWeight": round(float(current_weights[index]), 6),
            "proposedWeight": round(float(target_weights[index]), 6),
            "deltaWeight": round(float(target_weights[index] - current_weights[index]), 6),
            "riskContribution": round(float(risk_contribution[index]), 6),
            "expectedReturn": round(float(expected_returns[index]), 10),
        }
        for index, symbol in enumerate(symbols)
    ]

    return {
        "advisoryOnly": True,
        "objective": input_data.objective.value,
        "allocations": allocations,
        "turnover": round(turnover, 6),
        "portfolioVariance": round(portfolio_variance, 10),
        "portfolioVolatility": round(math.sqrt(portfolio_variance), 10),
        "concentration": {
            "maxWeight": round(float(np.max(target_weights)), 6),
            "topSymbol": symbols[max_index],
            "effectivePositionCount": round(
                1 / float(np.sum(target_weights * target_weights)),
                6,
            ),
        },
        "constraints": {
            "longOnly": input_data.constraints.longOnly,
            "maxWeight": input_data.constraints.maxWeight,
            "maxTurnover": input_data.constraints.maxTurnover,
        },
        "warnings": warnings,
    }, warnings


def _current_portfolio_weights(
    input_data: PortfolioOptimizationInput,
) -> tuple[np.ndarray, list[str]]:
    weights = np.array([position.currentWeight for position in input_data.positions], dtype=float)
    warnings: list[str] = []
    weights = np.where(np.isfinite(weights), weights, 0.0)
    if input_data.constraints.longOnly and np.any(weights < 0):
        weights = np.maximum(weights, 0.0)
        warnings.append("negative current weights were clamped for long-only optimization")
    return _normalize_weights(weights), warnings


def _optimization_covariance(
    input_data: PortfolioOptimizationInput,
    symbols: list[str],
) -> tuple[np.ndarray, list[str]]:
    size = len(symbols)
    if input_data.covariance is not None:
        try:
            covariance = np.array(input_data.covariance, dtype=float)
        except ValueError:
            covariance = np.empty((0, 0), dtype=float)
        if (
            covariance.shape == (size, size)
            and np.all(np.isfinite(covariance))
            and np.all(np.diag(covariance) > 0)
        ):
            return (covariance + covariance.T) / 2, []
        return _diagonal_covariance(input_data, symbols), [
            "invalid covariance matrix; using diagonal fallback"
        ]
    return _returns_covariance(input_data, symbols)


def _returns_covariance(
    input_data: PortfolioOptimizationInput,
    symbols: list[str],
) -> tuple[np.ndarray, list[str]]:
    returns_by_symbol = {
        series.symbol: [value for value in series.values if math.isfinite(value)]
        for series in input_data.returns
    }
    series_values = [returns_by_symbol.get(symbol, []) for symbol in symbols]
    min_len = min((len(values) for values in series_values), default=0)
    if len(symbols) >= 2 and min_len >= 2:
        matrix = np.array([values[-min_len:] for values in series_values], dtype=float)
        covariance = np.cov(matrix)
        if covariance.shape == (len(symbols), len(symbols)) and np.all(np.isfinite(covariance)):
            covariance = (covariance + covariance.T) / 2
            if np.all(np.diag(covariance) > 0):
                return covariance, []
    return _diagonal_covariance(input_data, symbols), []


def _diagonal_covariance(
    input_data: PortfolioOptimizationInput,
    symbols: list[str],
) -> np.ndarray:
    returns_by_symbol = {
        series.symbol: [value for value in series.values if math.isfinite(value)]
        for series in input_data.returns
    }
    variances: list[float] = []
    for symbol in symbols:
        values = returns_by_symbol.get(symbol, [])
        if len(values) >= 2:
            variances.append(max(float(np.var(np.array(values, dtype=float), ddof=1)), 1e-10))
        else:
            variances.append(0.0004)
    return np.diag(np.array(variances, dtype=float))


def _optimization_expected_returns(
    input_data: PortfolioOptimizationInput,
    symbols: list[str],
) -> np.ndarray:
    explicit = {
        position.symbol: position.expectedReturn
        for position in input_data.positions
        if position.expectedReturn is not None and math.isfinite(position.expectedReturn)
    }
    returns_by_symbol = {
        series.symbol: [value for value in series.values if math.isfinite(value)]
        for series in input_data.returns
    }
    values: list[float] = []
    for symbol in symbols:
        if symbol in explicit:
            values.append(float(explicit[symbol]))
            continue
        returns = returns_by_symbol.get(symbol, [])
        values.append(float(np.mean(returns)) if returns else 0.0)
    return np.array(values, dtype=float)


def _objective_weights(
    covariance: np.ndarray,
    expected_returns: np.ndarray,
    objective: PortfolioOptimizationObjective,
    warnings: list[str],
) -> np.ndarray:
    variances = np.maximum(np.diag(covariance), 1e-10)
    if objective == PortfolioOptimizationObjective.RISK_PARITY:
        return _normalize_weights(1 / np.sqrt(variances))
    if objective == PortfolioOptimizationObjective.MAX_RETURN:
        positive_returns = np.maximum(expected_returns, 0.0)
        if float(np.sum(positive_returns)) > 0:
            return _normalize_weights(positive_returns)
        warnings.append("max_return objective had no positive expected returns; using min_variance")
    return _normalize_weights(1 / variances)


def _apply_max_weight_constraint(
    weights: np.ndarray,
    max_weight: float | None,
) -> tuple[np.ndarray, list[str]]:
    if max_weight is None:
        return _normalize_weights(weights), []
    size = len(weights)
    if size == 0:
        return weights, []
    if max_weight * size < 1:
        return np.full(size, 1 / size, dtype=float), [
            "maxWeight below feasible floor; using equal weights"
        ]

    result = np.zeros(size, dtype=float)
    remaining_indices = list(range(size))
    remaining_weight = 1.0
    base = _normalize_weights(weights)
    while remaining_indices:
        subtotal = float(np.sum(base[remaining_indices]))
        if subtotal <= 0:
            equal = remaining_weight / len(remaining_indices)
            for index in remaining_indices:
                result[index] = equal
            break

        proposed = {
            index: float(base[index] / subtotal * remaining_weight)
            for index in remaining_indices
        }
        capped = [index for index, value in proposed.items() if value > max_weight]
        if not capped:
            for index, value in proposed.items():
                result[index] = value
            break
        for index in capped:
            result[index] = max_weight
        remaining_weight -= max_weight * len(capped)
        remaining_indices = [index for index in remaining_indices if index not in capped]
    return _normalize_weights(result), []


def _apply_turnover_constraint(
    target_weights: np.ndarray,
    current_weights: np.ndarray,
    max_turnover: float | None,
) -> np.ndarray:
    if max_turnover is None:
        return target_weights
    turnover = 0.5 * float(np.sum(np.abs(target_weights - current_weights)))
    if turnover <= max_turnover or turnover <= 0:
        return target_weights
    blend = max_turnover / turnover
    return cast(np.ndarray, current_weights + blend * (target_weights - current_weights))


def _risk_contribution(weights: np.ndarray, covariance: np.ndarray) -> np.ndarray:
    portfolio_variance = float(weights @ covariance @ weights)
    if portfolio_variance <= 0 or not math.isfinite(portfolio_variance):
        return np.zeros(len(weights), dtype=float)
    marginal = covariance @ weights
    return cast(np.ndarray, weights * marginal / portfolio_variance)


def _normalize_weights(weights: np.ndarray) -> np.ndarray:
    clean = np.maximum(np.where(np.isfinite(weights), weights, 0.0), 0.0)
    total = float(np.sum(clean))
    if total <= 0:
        return np.full(len(clean), 1 / len(clean), dtype=float) if len(clean) else clean
    return clean / total


def run_portfolio_risk(input_data: PortfolioRiskInput) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    positions = input_data.positions
    if not positions:
        return {
            "grossExposure": 0,
            "netExposure": 0,
            "deltaAdjustedExposure": 0,
            "concentration": [],
            "sectorExposure": [],
            "scenarios": [],
            "correlation": None,
            "covariance": None,
        }, ["portfolio_risk received no positions"]

    exposures: list[tuple[str, str | None, float, float]] = []
    for position in positions:
        notional = position.quantity * position.price
        delta = position.delta
        delta_value = delta if delta is not None and math.isfinite(delta) else 1.0
        exposures.append((position.symbol, position.sector, notional, notional * delta_value))

    notionals = np.array([entry[2] for entry in exposures], dtype=float)
    delta_notionals = np.array([entry[3] for entry in exposures], dtype=float)
    gross = float(np.sum(np.abs(notionals)))
    net = float(np.sum(notionals))
    delta_adjusted = float(np.sum(delta_notionals))

    by_symbol: dict[str, float] = defaultdict(float)
    by_sector: dict[str, float] = defaultdict(float)
    for symbol, sector, notional, _delta_notional in exposures:
        by_symbol[symbol] += notional
        by_sector[sector or "unknown"] += notional

    concentration = [
        {
            "symbol": symbol,
            "notional": round(notional, 6),
            "grossWeight": round(abs(notional) / gross, 6) if gross else 0,
        }
        for symbol, notional in sorted(
            by_symbol.items(),
            key=lambda item: abs(item[1]),
            reverse=True,
        )
    ]
    sector_exposure = [
        {
            "sector": sector,
            "notional": round(notional, 6),
            "grossWeight": round(abs(notional) / gross, 6) if gross else 0,
        }
        for sector, notional in sorted(
            by_sector.items(),
            key=lambda item: abs(item[1]),
            reverse=True,
        )
    ]
    scenarios = [
        {
            "shock": shock,
            "estimatedPnl": round(float(delta_adjusted * shock), 6),
            "estimatedReturnOnGross": (
                round(float(delta_adjusted * shock / gross), 6) if gross else 0
            ),
        }
        for shock in input_data.shocks
    ]

    returns_by_symbol = {
        series.symbol: [value for value in series.values if math.isfinite(value)]
        for series in input_data.returns
    }
    symbols = [item["symbol"] for item in concentration if item["symbol"] in returns_by_symbol]
    min_len = min((len(returns_by_symbol[symbol]) for symbol in symbols), default=0)
    covariance: list[list[float]] | None = None
    correlation: list[list[float]] | None = None

    if len(symbols) >= 2 and min_len >= 3:
        matrix = np.array([returns_by_symbol[symbol][-min_len:] for symbol in symbols], dtype=float)
        covariance_matrix = np.cov(matrix)
        correlation_matrix = np.corrcoef(matrix)
        covariance = np.round(covariance_matrix, 10).tolist()
        correlation = np.round(correlation_matrix, 6).tolist()
    else:
        warnings.append("insufficient_return_history_for_covariance")

    return {
        "grossExposure": round(gross, 6),
        "netExposure": round(net, 6),
        "deltaAdjustedExposure": round(delta_adjusted, 6),
        "concentration": concentration,
        "sectorExposure": sector_exposure,
        "scenarios": scenarios,
        "correlationSymbols": symbols if correlation is not None else [],
        "correlation": correlation,
        "covariance": covariance,
        "returnVolatility": _return_volatility(returns_by_symbol),
    }, warnings


def _return_volatility(returns_by_symbol: dict[str, list[float]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for symbol, values in sorted(returns_by_symbol.items()):
        if len(values) < 2:
            continue
        rows.append(
            {
                "symbol": symbol,
                "sampleCount": len(values),
                "dailyVolatility": round(statistics.stdev(values), 10),
                "annualizedVolatility": round(statistics.stdev(values) * math.sqrt(252), 10),
            }
        )
    return rows
