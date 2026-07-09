from __future__ import annotations

import math
import statistics
import time
from collections import defaultdict
from datetime import datetime, timezone
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
    SignalMatrixBarInput,
    SignalMatrixInput,
    SignalMatrixSettingsInput,
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
    if request.jobType == JobType.SIGNAL_MATRIX:
        return run_signal_matrix(SignalMatrixInput.model_validate(request.input))
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


def _round_or_nan(value: float, digits: int = 6) -> float:
    return round(value, digits) if math.isfinite(value) else math.nan


def _signal_sma(values: list[float], period: int) -> list[float]:
    result = [math.nan] * len(values)
    if period <= 0:
        return result
    rolling_sum = 0.0
    valid_count = 0
    for index, value in enumerate(values):
        if math.isfinite(value):
            rolling_sum += value
            valid_count += 1
        if index >= period:
            dropped = values[index - period]
            if math.isfinite(dropped):
                rolling_sum -= dropped
                valid_count -= 1
        if index >= period - 1 and valid_count == period:
            result[index] = _round_or_nan(rolling_sum / period)
    return result


def _signal_wma(values: list[float], period: int) -> list[float]:
    result = [math.nan] * len(values)
    if period <= 0:
        return result
    weight_total = period * (period + 1) / 2
    for index in range(period - 1, len(values)):
        weighted_sum = 0.0
        valid = True
        for offset in range(period):
            value = values[index - period + 1 + offset]
            if not math.isfinite(value):
                valid = False
                break
            weighted_sum += value * (offset + 1)
        if valid:
            result[index] = _round_or_nan(weighted_sum / weight_total)
    return result


def _signal_stddev(values: list[float], period: int) -> list[float]:
    result = [math.nan] * len(values)
    if period <= 0:
        return result
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        if any(not math.isfinite(value) for value in window):
            continue
        mean = sum(window) / period
        variance = sum((value - mean) ** 2 for value in window) / period
        result[index] = _round_or_nan(math.sqrt(variance))
    return result


def _signal_atr(bars: list[SignalMatrixBarInput], period: int) -> list[float]:
    result = [math.nan] * len(bars)
    if period <= 0 or len(bars) < period:
        return result
    true_range: list[float] = []
    for index, bar in enumerate(bars):
        if index == 0:
            true_range.append(bar.h - bar.l)
            continue
        previous_close = bars[index - 1].c
        true_range.append(
            max(bar.h - bar.l, abs(bar.h - previous_close), abs(bar.l - previous_close))
        )
    atr = sum(true_range[:period]) / period
    result[period - 1] = _round_or_nan(atr)
    for index in range(period, len(true_range)):
        atr = (atr * (period - 1) + true_range[index]) / period
        result[index] = _round_or_nan(atr)
    return result


def _signal_adx(bars: list[SignalMatrixBarInput], period: int) -> list[float]:
    length = len(bars)
    result = [math.nan] * length
    if period <= 0 or length <= period * 2:
        return result
    true_ranges = [0.0] * length
    plus_dm = [0.0] * length
    minus_dm = [0.0] * length
    for index in range(1, length):
        current = bars[index]
        previous = bars[index - 1]
        up_move = current.h - previous.h
        down_move = previous.l - current.l
        true_ranges[index] = max(
            current.h - current.l,
            abs(current.h - previous.c),
            abs(current.l - previous.c),
        )
        plus_dm[index] = up_move if up_move > down_move and up_move > 0 else 0
        minus_dm[index] = down_move if down_move > up_move and down_move > 0 else 0
    smoothed_tr = sum(true_ranges[1 : period + 1])
    smoothed_plus = sum(plus_dm[1 : period + 1])
    smoothed_minus = sum(minus_dm[1 : period + 1])
    dx = [math.nan] * length
    for index in range(period, length):
        if index > period:
            smoothed_tr = smoothed_tr - smoothed_tr / period + true_ranges[index]
            smoothed_plus = smoothed_plus - smoothed_plus / period + plus_dm[index]
            smoothed_minus = smoothed_minus - smoothed_minus / period + minus_dm[index]
        if not math.isfinite(smoothed_tr) or smoothed_tr <= 0:
            continue
        plus_di = smoothed_plus / smoothed_tr * 100
        minus_di = smoothed_minus / smoothed_tr * 100
        di_sum = plus_di + minus_di
        if di_sum <= 0:
            continue
        dx[index] = abs(plus_di - minus_di) / di_sum * 100
    dx_sum = 0.0
    dx_count = 0
    for index in range(period, length):
        if math.isfinite(dx[index]):
            dx_sum += dx[index]
            dx_count += 1
            if dx_count == period:
                result[index] = _round_or_nan(dx_sum / period)
                break
    for index in range(period * 2, length):
        if not math.isfinite(dx[index]) or not math.isfinite(result[index - 1]):
            continue
        result[index] = _round_or_nan((result[index - 1] * (period - 1) + dx[index]) / period)
    return result


def _signal_percent_rank(values: list[float], period: int) -> list[float]:
    result = [math.nan] * len(values)
    if period <= 1:
        return result
    for index in range(period - 1, len(values)):
        window = values[index - period + 1 : index + 1]
        current = values[index]
        if not math.isfinite(current) or any(not math.isfinite(value) for value in window):
            continue
        less_or_equal = sum(1 for value in window if value <= current)
        result[index] = _round_or_nan(((less_or_equal - 1) / (period - 1)) * 100)
    return result


def _signal_volatility_score(
    bars: list[SignalMatrixBarInput],
    shadow_length: int,
    shadow_stddev: float,
) -> list[float]:
    closes = [bar.c for bar in bars]
    bb_mid = _signal_sma(closes, shadow_length)
    bb_dev = [
        value * shadow_stddev if math.isfinite(value) else math.nan
        for value in _signal_stddev(closes, shadow_length)
    ]
    width_pct: list[float] = []
    for index, mid in enumerate(bb_mid):
        close = closes[index]
        dev = bb_dev[index]
        if not math.isfinite(mid) or not math.isfinite(dev) or close <= 0:
            width_pct.append(math.nan)
        else:
            width_pct.append((dev * 2) / close)
    rank = _signal_percent_rank(width_pct, 200)
    return [min(10, max(0, round(value / 10))) if math.isfinite(value) else 0 for value in rank]


def _bucket_start_ms(time_ms: int, timeframe: str) -> int:
    normalized = "1h" if timeframe == "60" else "4h" if timeframe == "240" else timeframe
    if normalized.isdigit():
        interval_ms = int(normalized) * 60_000
        return math.floor(time_ms / interval_ms) * interval_ms
    if normalized.lower().endswith("m") and normalized[:-1].isdigit():
        interval_ms = int(normalized[:-1]) * 60_000
        return math.floor(time_ms / interval_ms) * interval_ms
    if normalized.lower().endswith("h") and normalized[:-1].isdigit():
        interval_ms = int(normalized[:-1]) * 60 * 60_000
        return math.floor(time_ms / interval_ms) * interval_ms
    if normalized in {"D", "1D", "1d"}:
        value = datetime.fromtimestamp(time_ms / 1000, tz=timezone.utc)
        return int(datetime(value.year, value.month, value.day, tzinfo=timezone.utc).timestamp() * 1000)
    return time_ms


def _aggregate_signal_bars(
    bars: list[SignalMatrixBarInput],
    timeframe: str,
) -> list[SignalMatrixBarInput]:
    aggregated: list[SignalMatrixBarInput] = []
    for bar in bars:
        bucket_ms = _bucket_start_ms(bar.time * 1000, timeframe)
        bucket_time = bucket_ms // 1000
        if not aggregated or aggregated[-1].time != bucket_time:
            aggregated.append(
                SignalMatrixBarInput(
                    time=bucket_time,
                    ts=datetime.fromtimestamp(bucket_time, tz=timezone.utc).isoformat().replace("+00:00", "Z"),
                    date=datetime.fromtimestamp(bucket_time, tz=timezone.utc).date().isoformat(),
                    o=bar.o,
                    h=bar.h,
                    l=bar.l,
                    c=bar.c,
                    v=bar.v,
                )
            )
            continue
        last = aggregated[-1]
        last.h = max(last.h, bar.h)
        last.l = min(last.l, bar.l)
        last.c = bar.c
        last.v += bar.v
    return aggregated


def _signal_trend_direction(bars: list[SignalMatrixBarInput], basis_length: int) -> int:
    # Mirror lib/pyrus-signals-core/src/index.ts resolvePyrusSignalsTrendDirection:
    # return 0 (neutral / non-confirming) when the WMA basis is never computable —
    # empty bars, or fewer than basis_length bars so no finite basis comparison is
    # ever evaluable. Consumers must treat 0 as non-confirming, never a bullish
    # default.
    if not bars:
        return 0
    basis = _signal_wma([bar.c for bar in bars], basis_length)
    trend_direction = 1
    basis_computable = False
    for index in range(len(bars)):
        if index >= 5 and math.isfinite(basis[index]) and math.isfinite(basis[index - 5]):
            basis_computable = True
            if basis[index] > basis[index - 5]:
                trend_direction = 1
            elif basis[index] < basis[index - 5]:
                trend_direction = -1
    return trend_direction if basis_computable else 0


def _signal_session_key(bar: SignalMatrixBarInput) -> str | None:
    value = datetime.fromtimestamp(bar.time, tz=timezone.utc)
    minutes = value.hour * 60 + value.minute
    if 8 * 60 <= minutes < 17 * 60:
        return "london"
    if 13 * 60 <= minutes < 22 * 60:
        return "new_york"
    if 0 <= minutes < 9 * 60:
        return "tokyo"
    if minutes >= 22 * 60 or minutes < 7 * 60:
        return "sydney"
    return None


def _signal_session_matches(selected: str, current: str | None) -> bool:
    if not current:
        return False
    if selected == current:
        return True
    if selected == "asia":
        return current in {"tokyo", "sydney"}
    if selected in {"new_york_am", "new_york_pm"}:
        return current == "new_york"
    return False


def _pivot_high(bars: list[SignalMatrixBarInput], pivot_index: int, strength: int) -> float | None:
    if pivot_index - strength < 0 or pivot_index + strength >= len(bars):
        return None
    pivot = bars[pivot_index].h
    if not math.isfinite(pivot):
        return None
    for index in range(pivot_index - strength, pivot_index + strength + 1):
        if index != pivot_index and bars[index].h > pivot:
            return None
    return pivot


def _pivot_low(bars: list[SignalMatrixBarInput], pivot_index: int, strength: int) -> float | None:
    if pivot_index - strength < 0 or pivot_index + strength >= len(bars):
        return None
    pivot = bars[pivot_index].l
    if not math.isfinite(pivot):
        return None
    for index in range(pivot_index - strength, pivot_index + strength + 1):
        if index != pivot_index and bars[index].l < pivot:
            return None
    return pivot


def _median_positive_bar_interval(bars: list[SignalMatrixBarInput]) -> float:
    intervals = [
        bars[index].time - bars[index - 1].time
        for index in range(1, len(bars))
        if math.isfinite(bars[index].time - bars[index - 1].time)
        and bars[index].time - bars[index - 1].time > 0
    ]
    if not intervals:
        return 0
    intervals.sort()
    return intervals[len(intervals) // 2]


def _has_hard_bar_gap(
    bars: list[SignalMatrixBarInput],
    index: int,
    median_interval: float,
) -> bool:
    return index > 0 and median_interval > 0 and bars[index].time - bars[index - 1].time > median_interval * 2


def _signal_round_feature(value: float) -> float:
    # Mirrors buildPyrusSignalsDirectionalFeatures roundFeature: finite -> 6dp, else 0.
    return round(value, 6) if math.isfinite(value) else 0.0


def _signal_clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _signal_directional_features(
    bars: list[SignalMatrixBarInput],
    index: int,
    direction: int,
    mtf_directions: list[int],
    adx: float,
    volatility_score: float,
    atr: float,
) -> dict[str, Any]:
    # Deterministic port of buildPyrusSignalsDirectionalFeatures
    # (lib/pyrus-signals-core/src/index.ts:958-1057). Keeps STA rows on the
    # SOT-outcome score model instead of the setup-quality fallback.
    if index < 0 or index >= len(bars):
        return {
            "version": "directional-features-v1",
            "shortMomentumPct": 0,
            "mediumMomentumPct": 0,
            "longMomentumPct": 0,
            "riskAdjustedMomentum": 0,
            "rangePosition20": 0.5,
            "rangeComponent": 0,
            "volumeRatio20": 1,
            "volumeExpansion": 0,
            "adxComponent": -1,
            "volatilityComponent": 0,
            "mtfAlignment": 0,
            "atrPct": 0,
        }
    current = bars[index]
    normalized_direction = 1 if direction >= 0 else -1

    def percent_change(lookback: int) -> float:
        previous_index = index - lookback
        if previous_index < 0:
            return 0.0
        previous = bars[previous_index]
        if not math.isfinite(previous.c) or previous.c <= 0:
            return 0.0
        return ((current.c - previous.c) / previous.c) * 100 * normalized_direction

    short_momentum = percent_change(6)
    medium_momentum = percent_change(20)
    long_momentum = percent_change(78)

    range_bars = bars[max(0, index - 19) : index + 1]
    range_high = max((bar.h for bar in range_bars), default=math.nan)
    range_low = min((bar.l for bar in range_bars), default=math.nan)
    if math.isfinite(range_high) and math.isfinite(range_low) and range_high > range_low:
        range_position = (
            (current.c - range_low) / (range_high - range_low)
            if normalized_direction == 1
            else (range_high - current.c) / (range_high - range_low)
        )
    else:
        range_position = 0.5

    prior_volumes = [
        bar.v for bar in bars[max(0, index - 20) : index] if math.isfinite(bar.v)
    ]
    prior_volume_average = sum(prior_volumes) / len(prior_volumes) if prior_volumes else 0.0
    volume_ratio = (
        current.v / prior_volume_average
        if prior_volume_average > 0 and current.v > 0
        else 1.0
    )

    safe_adx = adx if math.isfinite(adx) else 0.0
    safe_volatility = volatility_score if math.isfinite(volatility_score) else 0.0
    mtf_alignment = (
        sum(1 for value in mtf_directions if value == normalized_direction)
        - sum(1 for value in mtf_directions if value == -normalized_direction) * 0.5
    )
    atr_pct = (
        (atr / current.c) * 100
        if math.isfinite(atr) and atr > 0 and current.c > 0
        else 0.0
    )
    risk_adjusted_momentum = medium_momentum / max(0.25, atr_pct or 0.25)
    clamped_range = _signal_clamp(range_position, 0, 1)

    return {
        "version": "directional-features-v1",
        "shortMomentumPct": _signal_round_feature(short_momentum),
        "mediumMomentumPct": _signal_round_feature(medium_momentum),
        "longMomentumPct": _signal_round_feature(long_momentum),
        "riskAdjustedMomentum": _signal_round_feature(risk_adjusted_momentum),
        "rangePosition20": _signal_round_feature(clamped_range),
        "rangeComponent": _signal_round_feature((clamped_range - 0.5) * 4),
        "volumeRatio20": _signal_round_feature(volume_ratio),
        "volumeExpansion": _signal_round_feature(_signal_clamp(volume_ratio - 1, -1, 2)),
        "adxComponent": _signal_round_feature(_signal_clamp((safe_adx - 18) / 12, -1, 2.5)),
        "volatilityComponent": _signal_round_feature(
            _signal_clamp(1 - abs(safe_volatility - 6) / 6, -0.5, 1)
        ),
        "mtfAlignment": _signal_round_feature(mtf_alignment),
        "atrPct": _signal_round_feature(atr_pct),
    }


def _build_signal_filter_state(
    bars: list[SignalMatrixBarInput],
    index: int,
    direction: int,
    settings: SignalMatrixSettingsInput,
    adx: list[float],
    volatility_score: list[float],
    atr_smoothed: list[float],
) -> dict[str, Any]:
    mtf_directions = [
        _signal_trend_direction(_aggregate_signal_bars(bars[: index + 1], timeframe), settings.basisLength)
        for timeframe in [settings.mtf1, settings.mtf2, settings.mtf3]
    ]
    current_adx = adx[index]
    current_volatility_score = volatility_score[index]
    current_session_key = _signal_session_key(bars[index])
    directional_features = _signal_directional_features(
        bars,
        index,
        direction,
        mtf_directions,
        current_adx,
        current_volatility_score,
        atr_smoothed[index],
    )
    mtf_pass = [
        (not settings.requireMtf1) or mtf_directions[0] == direction,
        (not settings.requireMtf2) or mtf_directions[1] == direction,
        (not settings.requireMtf3) or mtf_directions[2] == direction,
    ]
    adx_pass = (not settings.requireAdx) or (
        math.isfinite(current_adx) and current_adx >= settings.adxMin
    )
    volatility_pass = (not settings.requireVolScoreRange) or (
        math.isfinite(current_volatility_score)
        and settings.volScoreMin <= current_volatility_score <= settings.volScoreMax
    )
    session_pass = (not settings.restrictToSelectedSessions) or any(
        _signal_session_matches(session, current_session_key) for session in settings.sessions
    )
    gated_pass = all(mtf_pass) and adx_pass and volatility_pass and session_pass
    return {
        "enabled": settings.signalFiltersEnabled,
        "direction": direction,
        "mtfDirections": mtf_directions,
        "adx": current_adx if math.isfinite(current_adx) else None,
        "volatilityScore": current_volatility_score if math.isfinite(current_volatility_score) else None,
        "directionalFeatures": directional_features,
        "sessionKey": current_session_key,
        "mtfPass": mtf_pass,
        "adxPass": adx_pass,
        "volatilityPass": volatility_pass,
        "sessionPass": session_pass,
        "passes": (not settings.signalFiltersEnabled) or gated_pass,
    }


def _event_iso(bar: SignalMatrixBarInput) -> str:
    return bar.ts or datetime.fromtimestamp(bar.time, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _evaluate_signal_cell(
    bars: list[SignalMatrixBarInput],
    settings: SignalMatrixSettingsInput,
) -> dict[str, Any]:
    closes = [bar.c for bar in bars]
    basis = _signal_wma(closes, settings.basisLength)
    atr_raw = _signal_atr(bars, settings.atrLength)
    atr_smoothed = _signal_sma(atr_raw, settings.atrSmoothing)
    upper_band = [
        _round_or_nan(value + atr_smoothed[index] * settings.volatilityMultiplier)
        if math.isfinite(value) and math.isfinite(atr_smoothed[index])
        else math.nan
        for index, value in enumerate(basis)
    ]
    lower_band = [
        _round_or_nan(value - atr_smoothed[index] * settings.volatilityMultiplier)
        if math.isfinite(value) and math.isfinite(atr_smoothed[index])
        else math.nan
        for index, value in enumerate(basis)
    ]
    adx = _signal_adx(bars, settings.adxLength)
    volume_sma = _signal_sma([bar.v for bar in bars], settings.volumeMaLength)
    volatility_score = _signal_volatility_score(
        bars,
        settings.shadowLength,
        settings.shadowStdDev,
    )
    trend_direction_series = [1] * len(bars)
    regime_direction = [1] * len(bars)
    signal_events: list[dict[str, Any]] = []
    trend_direction = 1
    trend_basis_computable = False
    market_structure_direction = 0
    last_swing_high = math.nan
    previous_swing_high = math.nan
    last_swing_low = math.nan
    previous_swing_low = math.nan
    breakable_high = math.nan
    breakable_low = math.nan
    previous_regime_direction: int | None = None
    median_interval = _median_positive_bar_interval(bars)

    def passes_choch_filters(index: int, direction: str, pivot_level: float) -> bool:
        current = bars[index]
        if not math.isfinite(pivot_level):
            return False
        current_atr = atr_raw[index]
        atr_buffer = current_atr * settings.chochAtrBuffer if math.isfinite(current_atr) and settings.chochAtrBuffer > 0 else 0
        threshold = pivot_level + atr_buffer if direction == "long" else pivot_level - atr_buffer
        if direction == "long":
            buffered_break = current.h > threshold if settings.bosConfirmation == "wicks" else current.c > threshold
        else:
            buffered_break = current.l < threshold if settings.bosConfirmation == "wicks" else current.c < threshold
        if not buffered_break:
            return False
        if settings.chochBodyExpansionAtr > 0:
            if not math.isfinite(current_atr):
                return False
            if abs(current.c - current.o) < current_atr * settings.chochBodyExpansionAtr:
                return False
        if settings.chochVolumeGate > 0:
            baseline_volume = volume_sma[index]
            if not math.isfinite(baseline_volume) or current.v < baseline_volume * settings.chochVolumeGate:
                return False
        return True

    for index, current in enumerate(bars):
        hard_gap_bar = _has_hard_bar_gap(bars, index, median_interval)
        if index >= 5 and math.isfinite(basis[index]) and math.isfinite(basis[index - 5]):
            trend_basis_computable = True
            if basis[index] > basis[index - 5]:
                trend_direction = 1
            elif basis[index] < basis[index - 5]:
                trend_direction = -1
        trend_direction_series[index] = trend_direction

        pivot_index = index - settings.timeHorizon
        if pivot_index >= settings.timeHorizon:
            pivot_high = _pivot_high(bars, pivot_index, settings.timeHorizon)
            if pivot_high is not None:
                previous_swing_high = last_swing_high
                last_swing_high = pivot_high
                breakable_high = pivot_high
            pivot_low = _pivot_low(bars, pivot_index, settings.timeHorizon)
            if pivot_low is not None:
                previous_swing_low = last_swing_low
                last_swing_low = pivot_low
                breakable_low = pivot_low

        bullish_bos = False
        bearish_bos = False
        bullish_choch = False
        bearish_choch = False
        if math.isfinite(breakable_high) and (
            current.h > breakable_high if settings.bosConfirmation == "wicks" else current.c > breakable_high
        ):
            if market_structure_direction == 1:
                bullish_bos = True
                breakable_high = math.nan
            elif passes_choch_filters(index, "long", breakable_high):
                bullish_choch = True
                market_structure_direction = 1
                breakable_high = math.nan
        if math.isfinite(breakable_low) and (
            current.l < breakable_low if settings.bosConfirmation == "wicks" else current.c < breakable_low
        ):
            if market_structure_direction == -1:
                bearish_bos = True
                breakable_low = math.nan
            elif passes_choch_filters(index, "short", breakable_low):
                bearish_choch = True
                market_structure_direction = -1
                breakable_low = math.nan

        regime_direction[index] = market_structure_direction if market_structure_direction != 0 else trend_direction
        active_regime_direction = regime_direction[index]
        active_trend_line = lower_band[index] if active_regime_direction == 1 else upper_band[index]
        regime_flipped = previous_regime_direction is not None and previous_regime_direction != active_regime_direction
        if not hard_gap_bar and not regime_flipped and math.isfinite(active_trend_line):
            pass
        previous_regime_direction = active_regime_direction
        # The API matrix path evaluates completed bars with includeProvisionalSignals=true.
        actionable = True

        if bullish_bos or bearish_bos:
            pass
        if bullish_choch or bearish_choch:
            direction_num = 1 if bullish_choch else -1
            event_direction = "long" if bullish_choch else "short"
            filter_state = _build_signal_filter_state(
                bars,
                index,
                direction_num,
                settings,
                adx,
                volatility_score,
                atr_smoothed,
            )
            if filter_state["passes"] and actionable:
                signal_price = (
                    current.l - (atr_raw[index] * settings.signalOffsetAtr if math.isfinite(atr_raw[index]) else 0)
                    if event_direction == "long"
                    else current.h + (atr_raw[index] * settings.signalOffsetAtr if math.isfinite(atr_raw[index]) else 0)
                )
                signal_events.append(
                    {
                        "eventType": "buy_signal" if event_direction == "long" else "sell_signal",
                        "direction": event_direction,
                        "barIndex": index,
                        "time": current.time,
                        "ts": _event_iso(current),
                        "price": _round_or_nan(signal_price),
                        "close": current.c,
                        "actionable": actionable,
                        "filtered": False,
                        "filterState": filter_state,
                    }
                )
        _ = previous_swing_high
        _ = previous_swing_low

    return {
        "adx": adx,
        "volatilityScore": volatility_score,
        "trendDirection": trend_direction_series,
        "regimeDirection": regime_direction,
        # False when the WMA basis slope was never evaluable (fewer than
        # basisLength + 5 bars): the direction series then still carry their
        # bullish seed, not a measured trend (mirrors pyrus-signals-core).
        "trendBasisComputable": trend_basis_computable,
        # Final latched market-structure (CHoCH) direction: 1, -1, or 0 when
        # no structure break ever latched.
        "marketStructureDirection": market_structure_direction,
        "signalEvents": signal_events,
    }


def _normalized_indicator_direction(value: float | int | None) -> str | None:
    if value == 1:
        return "bullish"
    if value == -1:
        return "bearish"
    return None


def _trend_age_bucket(value: int | None) -> str | None:
    if value is None:
        return None
    if value > 50:
        return "old"
    if value > 20:
        return "mature"
    return "new"


def _trend_age(directions: list[int], current_direction: int | None) -> int | None:
    if not directions or current_direction is None:
        return None
    last_index = len(directions) - 1
    flip_index = 0
    for index in range(last_index - 1, -1, -1):
        direction = directions[index] if directions[index] in {1, -1} else None
        if direction is not None and direction != current_direction:
            flip_index = index + 1
            break
    return max(0, last_index - flip_index)


def _finite_rounded(value: Any, digits: int = 1) -> float | None:
    numeric = float(value) if isinstance(value, int | float) else math.nan
    if not math.isfinite(numeric):
        return None
    return round(numeric, digits)


def _signal_indicator_snapshot(
    bars: list[SignalMatrixBarInput],
    evaluation: dict[str, Any],
    settings: SignalMatrixSettingsInput,
    signal: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if not bars:
        return None
    last_index = len(bars) - 1
    regime_direction = cast(list[int], evaluation["regimeDirection"])
    trend_direction = cast(list[int], evaluation["trendDirection"])
    # An unwarmed basis means the direction series still carry their bullish
    # seed, not a measured trend. Trust the last bar's direction only when the
    # basis slope was actually evaluable, or when market structure (CHoCH)
    # latched a real direction; otherwise the trend is unknown (None), which
    # downstream MTF/entry gates treat as non-confirming (mirrors
    # computeSignalMonitorIndicatorSnapshotBase in signal-monitor.ts).
    if evaluation.get("trendBasisComputable"):
        current_direction: int | None = (
            regime_direction[last_index]
            if regime_direction[last_index] in {1, -1}
            else trend_direction[last_index]
        )
    else:
        structure_direction = evaluation.get("marketStructureDirection")
        current_direction = (
            structure_direction if structure_direction in {1, -1} else None
        )
    if current_direction not in {1, -1}:
        current_direction = None
    trend_age_bars = _trend_age(regime_direction, current_direction)
    adx_values = cast(list[float], evaluation["adx"])
    volatility_values = cast(list[float], evaluation["volatilityScore"])
    adx = _finite_rounded(adx_values[last_index])
    volatility_score = _finite_rounded(volatility_values[last_index], 0)
    mtf = []
    for timeframe, required in [
        (settings.mtf1, settings.requireMtf1),
        (settings.mtf2, settings.requireMtf2),
        (settings.mtf3, settings.requireMtf3),
    ]:
        direction = _signal_trend_direction(_aggregate_signal_bars(bars, timeframe), settings.basisLength)
        mtf.append(
            {
                "timeframe": timeframe,
                "direction": _normalized_indicator_direction(direction),
                "required": required,
                "pass": (not required) or (current_direction is not None and direction == current_direction),
            }
        )
    return {
        "trendDirection": _normalized_indicator_direction(current_direction),
        "trendAgeBars": trend_age_bars,
        "trendAgeBucket": _trend_age_bucket(trend_age_bars),
        "adx": adx,
        "strength": None if adx is None else "strong" if adx >= 25 else "weak",
        "volatilityScore": volatility_score,
        "mtf": mtf,
        "filterState": signal.get("filterState") if signal else None,
    }


def run_signal_matrix(input_data: SignalMatrixInput) -> tuple[dict[str, Any], list[str]]:
    warnings: list[str] = []
    states: list[dict[str, Any]] = []
    for cell in input_data.cells:
        bars = sorted(cell.bars, key=lambda bar: bar.time)
        if not bars:
            states.append(
                {
                    "symbol": cell.symbol,
                    "timeframe": cell.timeframe,
                    "status": "unavailable",
                    "signal": None,
                    "barsSinceSignal": None,
                    "fresh": False,
                    "indicatorSnapshot": None,
                    "warning": "No bars were provided for this signal matrix cell.",
                }
            )
            continue
        evaluation = _evaluate_signal_cell(bars, cell.settings)
        signal = cast(list[dict[str, Any]], evaluation["signalEvents"])[-1] if evaluation["signalEvents"] else None
        bars_since_signal = None
        fresh = False
        if signal is not None:
            bars_since_signal = max(0, len(bars) - 1 - int(signal["barIndex"]))
            fresh = bars_since_signal <= cell.freshWindowBars
        states.append(
            {
                "symbol": cell.symbol,
                "timeframe": cell.timeframe,
                "status": "ok",
                "signal": signal,
                "barsSinceSignal": bars_since_signal,
                "fresh": fresh,
                "indicatorSnapshot": _signal_indicator_snapshot(
                    bars,
                    evaluation,
                    cell.settings,
                    signal,
                ),
                "warning": None,
            }
        )
    if not input_data.cells:
        warnings.append("signal_matrix received no cells")
    return {"cellCount": len(input_data.cells), "states": states}, warnings


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
    target_weights = _normalize_weights(
        target_weights,
        allow_short=not input_data.constraints.longOnly,
    )
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
    return (
        _normalize_weights(weights, allow_short=not input_data.constraints.longOnly),
        warnings,
    )


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


def _normalize_weights(weights: np.ndarray, allow_short: bool = False) -> np.ndarray:
    clean = np.where(np.isfinite(weights), weights, 0.0)
    if not allow_short:
        clean = np.maximum(clean, 0.0)
    total = float(np.sum(np.abs(clean)) if allow_short else np.sum(clean))
    if total <= 0:
        return np.full(len(clean), 1 / len(clean), dtype=float) if len(clean) else clean
    return clean / total


def _finite_or_none(value: float) -> float | None:
    return value if math.isfinite(value) else None


def _json_finite_matrix(matrix: np.ndarray, decimals: int) -> list[list[float | None]]:
    return [
        [_finite_or_none(value) for value in row]
        for row in np.round(matrix, decimals).tolist()
    ]


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
    covariance: list[list[float | None]] | None = None
    correlation: list[list[float | None]] | None = None

    if len(symbols) >= 2 and min_len >= 3:
        matrix = np.array([returns_by_symbol[symbol][-min_len:] for symbol in symbols], dtype=float)
        covariance_matrix = np.cov(matrix)
        correlation_matrix = np.corrcoef(matrix)
        covariance = _json_finite_matrix(covariance_matrix, 10)
        correlation = _json_finite_matrix(correlation_matrix, 6)
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
