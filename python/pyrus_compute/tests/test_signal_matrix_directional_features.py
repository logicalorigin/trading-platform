"""Directional-features port tests.

Pins the Python port of buildPyrusSignalsDirectionalFeatures
(lib/pyrus-signals-core/src/index.ts) that keeps Python-sourced STA matrix rows
on the SOT-outcome score model instead of the setup-quality fallback:

- hand-computed unit cases for the exact feature math (long/short/default),
- a JS-generated golden fixture for cross-language parity (tolerance 1e-6;
  regenerate with fixtures/generate-directional-features-parity.mts),
- a run_signal_matrix integration case proving emitted signals carry
  filterState.directionalFeatures end to end,
- a full-pipeline JS golden fixture (signal-matrix-pipeline-parity.json,
  same generator) driving run_signal_matrix end to end: trend direction,
  bar aggregation, the CHoCH/BOS loop, filter gates, and the indicator
  snapshot. Its h1-data-starved-htf-required case pins the H1 regression —
  a never-computable HTF basis must be neutral (0), never a bullish default.
"""

import json
import math
from pathlib import Path

from pyrus_compute.jobs import _signal_directional_features, run_signal_matrix
from pyrus_compute.models import (
    SignalMatrixBarInput,
    SignalMatrixCellInput,
    SignalMatrixInput,
    SignalMatrixSettingsInput,
)

FEATURE_KEYS = [
    "shortMomentumPct",
    "mediumMomentumPct",
    "longMomentumPct",
    "riskAdjustedMomentum",
    "rangePosition20",
    "rangeComponent",
    "volumeRatio20",
    "volumeExpansion",
    "adxComponent",
    "volatilityComponent",
    "mtfAlignment",
    "atrPct",
]

PARITY_FIXTURE = Path(__file__).parent / "fixtures" / "directional-features-parity.json"
PIPELINE_PARITY_FIXTURE = (
    Path(__file__).parent / "fixtures" / "signal-matrix-pipeline-parity.json"
)


def _bar(
    i: int, o: float, h: float, low: float, c: float, v: float = 1000.0
) -> SignalMatrixBarInput:
    return SignalMatrixBarInput(time=1_700_000_000 + i * 300, o=o, h=h, l=low, c=c, v=v)


def _flat_then_pop_series() -> list[SignalMatrixBarInput]:
    # Six flat bars at 100, then a close at 103: short momentum has a known
    # hand-computed value while the 20/78-bar lookbacks run off the array.
    bars = [_bar(i, 100.0, 100.5, 99.5, 100.0) for i in range(6)]
    bars.append(_bar(6, 100.0, 103.5, 99.5, 103.0))
    return bars


def test_long_direction_hand_computed_features() -> None:
    features = _signal_directional_features(
        _flat_then_pop_series(),
        index=6,
        direction=1,
        mtf_directions=[1, 1, 1],
        adx=30.0,
        volatility_score=6.0,
        atr=2.0,
    )
    assert features["version"] == "directional-features-v1"
    assert features["shortMomentumPct"] == 3.0  # (103-100)/100 * 100
    assert features["mediumMomentumPct"] == 0.0  # 20-bar lookback off-array
    assert features["longMomentumPct"] == 0.0  # 78-bar lookback off-array
    assert features["rangePosition20"] == 0.875  # (103-99.5)/(103.5-99.5)
    assert features["rangeComponent"] == 1.5  # (0.875-0.5)*4
    assert features["volumeRatio20"] == 1.0
    assert features["volumeExpansion"] == 0.0
    assert features["adxComponent"] == 1.0  # (30-18)/12
    assert features["volatilityComponent"] == 1.0  # 1-|6-6|/6
    assert features["mtfAlignment"] == 3.0  # three matches, zero opposed
    assert features["atrPct"] == 1.941748  # (2/103)*100 rounded to 6dp
    assert features["riskAdjustedMomentum"] == 0.0  # medium momentum is 0


def test_short_direction_flips_sign_and_range_position() -> None:
    features = _signal_directional_features(
        _flat_then_pop_series(),
        index=6,
        direction=-1,
        mtf_directions=[1, 1, -1],
        adx=30.0,
        volatility_score=6.0,
        atr=2.0,
    )
    assert features["shortMomentumPct"] == -3.0
    assert features["rangePosition20"] == 0.125  # (103.5-103)/(103.5-99.5)
    # One match minus half-weighted opposition: 1 - 2*0.5.
    assert features["mtfAlignment"] == 0.0


def test_out_of_range_index_returns_neutral_defaults() -> None:
    bars = _flat_then_pop_series()
    features = _signal_directional_features(
        bars,
        index=len(bars),
        direction=1,
        mtf_directions=[1, 1, 1],
        adx=30.0,
        volatility_score=6.0,
        atr=2.0,
    )
    assert features["version"] == "directional-features-v1"
    assert features["rangePosition20"] == 0.5
    assert features["volumeRatio20"] == 1
    assert features["adxComponent"] == -1
    assert features["mtfAlignment"] == 0


def test_parity_with_js_producer_golden_fixture() -> None:
    fixture = json.loads(PARITY_FIXTURE.read_text())
    bars = [
        SignalMatrixBarInput(
            time=bar["time"], o=bar["o"], h=bar["h"], l=bar["l"], c=bar["c"], v=bar["v"]
        )
        for bar in fixture["bars"]
    ]
    for case in fixture["cases"]:
        features = _signal_directional_features(
            bars,
            index=case["index"],
            direction=case["direction"],
            mtf_directions=case["mtfDirections"],
            adx=case["adx"],
            volatility_score=case["volatilityScore"],
            atr=case["atr"],
        )
        expected = case["expected"]
        assert features["version"] == expected["version"]
        for key in FEATURE_KEYS:
            assert math.isfinite(features[key]), f"{key} not finite for case {case['index']}"
            assert abs(features[key] - expected[key]) <= 1e-6, (
                f"case index={case['index']} direction={case['direction']} key={key}: "
                f"python={features[key]} js={expected[key]}"
            )


def _forming_bar_breakout_series() -> list[SignalMatrixBarInput]:
    # Port of the pyrus-signals-core test recipe (index.test.ts): a mild
    # downtrend with one clear swing high at i=40, then a decisive breakout on
    # the final bar -> a single bullish CHoCH on the live edge.
    bars: list[SignalMatrixBarInput] = []
    for i in range(120):
        base = 112.0 if i == 40 else 100.0 - i * 0.15
        bars.append(_bar(i, base, base + 0.5, base - 0.5, base))
    bars[-1] = _bar(119, 90.0, 130.0, 89.0, 129.0)
    return bars


def test_run_signal_matrix_attaches_directional_features() -> None:
    result, warnings = run_signal_matrix(
        SignalMatrixInput(
            cells=[
                SignalMatrixCellInput(
                    symbol="TEST",
                    timeframe="5m",
                    settings=SignalMatrixSettingsInput(waitForBarClose=False),
                    bars=_forming_bar_breakout_series(),
                )
            ]
        )
    )
    assert warnings == []
    state = result["states"][0]
    assert state["status"] == "ok"
    assert state["signal"] is not None, "breakout series should emit a CHoCH signal"
    for filter_state in (
        state["signal"]["filterState"],
        state["indicatorSnapshot"]["filterState"],
    ):
        features = filter_state["directionalFeatures"]
        assert features["version"] == "directional-features-v1"
        for key in FEATURE_KEYS:
            assert isinstance(features[key], (int, float)), f"missing feature {key}"
        assert 0 <= features["rangePosition20"] <= 1
    assert (
        state["signal"]["filterState"]["directionalFeatures"]
        == state["indicatorSnapshot"]["filterState"]["directionalFeatures"]
    )


def _direction_label(value: int | None) -> str | None:
    # Mirror of _normalized_indicator_direction: 0 (neutral) must map to None.
    if value == 1:
        return "bullish"
    if value == -1:
        return "bearish"
    return None


def _assert_number_or_none(context: str, actual: object, expected: object) -> None:
    if expected is None:
        assert actual is None, f"{context}: python={actual} js=None"
        return
    assert isinstance(actual, (int, float)), f"{context}: python={actual!r} js={expected}"
    assert isinstance(expected, (int, float)), f"{context}: unexpected fixture value {expected!r}"
    assert abs(float(actual) - float(expected)) <= 1e-6, (
        f"{context}: python={actual} js={expected}"
    )


def _assert_filter_state_parity(context: str, actual: dict, expected: dict) -> None:
    assert actual["enabled"] == expected["enabled"], f"{context}.enabled"
    assert actual["direction"] == expected["direction"], f"{context}.direction"
    assert list(actual["mtfDirections"]) == list(expected["mtfDirections"]), (
        f"{context}.mtfDirections: python={actual['mtfDirections']} "
        f"js={expected['mtfDirections']}"
    )
    assert list(actual["mtfPass"]) == list(expected["mtfPass"]), (
        f"{context}.mtfPass: python={actual['mtfPass']} js={expected['mtfPass']}"
    )
    for flag in ("adxPass", "volatilityPass", "sessionPass", "passes"):
        assert actual[flag] == expected[flag], f"{context}.{flag}"
    assert actual["sessionKey"] == expected["sessionKey"], f"{context}.sessionKey"
    _assert_number_or_none(f"{context}.adx", actual["adx"], expected["adx"])
    _assert_number_or_none(
        f"{context}.volatilityScore",
        actual["volatilityScore"],
        expected["volatilityScore"],
    )
    features = actual["directionalFeatures"]
    expected_features = expected["directionalFeatures"]
    assert features["version"] == expected_features["version"], f"{context}.version"
    for key in FEATURE_KEYS:
        _assert_number_or_none(
            f"{context}.directionalFeatures.{key}", features[key], expected_features[key]
        )


def test_full_pipeline_parity_with_js_golden_fixture() -> None:
    fixture = json.loads(PIPELINE_PARITY_FIXTURE.read_text())
    assert fixture["cases"], "pipeline parity fixture has no cases"
    for case in fixture["cases"]:
        name = case["name"]
        bars = [
            SignalMatrixBarInput(
                time=bar["time"], o=bar["o"], h=bar["h"], l=bar["l"], c=bar["c"], v=bar["v"]
            )
            for bar in case["bars"]
        ]
        result, warnings = run_signal_matrix(
            SignalMatrixInput(
                cells=[
                    SignalMatrixCellInput(
                        symbol=case["symbol"],
                        timeframe=case["timeframe"],
                        settings=SignalMatrixSettingsInput(**case["settings"]),
                        bars=bars,
                    )
                ]
            )
        )
        assert warnings == [], name
        state = result["states"][0]
        expected = case["expected"]
        assert state["status"] == expected["status"], name

        if expected["signal"] is None:
            assert state["signal"] is None, (
                f"{name}: python emitted "
                f"{state['signal'] and state['signal']['eventType']}@"
                f"{state['signal'] and state['signal']['barIndex']} "
                "but the JS reference suppresses this signal"
            )
        else:
            assert state["signal"] is not None, (
                f"{name}: python suppressed a signal the JS reference emits "
                f"({expected['signal']['eventType']}@{expected['signal']['barIndex']})"
            )
            signal = state["signal"]
            for key in ("eventType", "direction", "barIndex", "time"):
                assert signal[key] == expected["signal"][key], f"{name}.signal.{key}"
            _assert_number_or_none(
                f"{name}.signal.price", signal["price"], expected["signal"]["price"]
            )
            _assert_number_or_none(
                f"{name}.signal.close", signal["close"], expected["signal"]["close"]
            )
            _assert_filter_state_parity(
                f"{name}.signal.filterState",
                signal["filterState"],
                expected["signal"]["filterState"],
            )

        snapshot = state["indicatorSnapshot"]
        expected_snapshot = expected["snapshot"]
        assert snapshot is not None, name
        assert snapshot["trendDirection"] == _direction_label(
            expected_snapshot["trendDirection"]
        ), f"{name}.snapshot.trendDirection"
        assert len(snapshot["mtf"]) == len(expected_snapshot["mtf"]), name
        for actual_mtf, expected_mtf in zip(snapshot["mtf"], expected_snapshot["mtf"]):
            timeframe = expected_mtf["timeframe"]
            assert actual_mtf["timeframe"] == timeframe, f"{name}.snapshot.mtf.timeframe"
            assert actual_mtf["direction"] == _direction_label(expected_mtf["direction"]), (
                f"{name}.snapshot.mtf[{timeframe}].direction: "
                f"python={actual_mtf['direction']} "
                f"js={_direction_label(expected_mtf['direction'])}"
            )
            assert actual_mtf["required"] == expected_mtf["required"], (
                f"{name}.snapshot.mtf[{timeframe}].required"
            )
            assert actual_mtf["pass"] == expected_mtf["pass"], (
                f"{name}.snapshot.mtf[{timeframe}].pass: "
                f"python={actual_mtf['pass']} js={expected_mtf['pass']}"
            )


def _mk_bar(index: int, close: float) -> SignalMatrixBarInput:
    return SignalMatrixBarInput(
        time=1_700_000_000 + index * 300,
        o=close,
        h=close + 0.5,
        l=close - 0.5,
        c=close,
        v=1000.0,
    )


def _downtrend_bars(count: int) -> list[SignalMatrixBarInput]:
    return [_mk_bar(index, 200 - index * 0.4) for index in range(count)]


class TestUnwarmedTrendGuard:
    """Mirrors signal-monitor.ts: an unwarmed basis must not report the
    direction series' bullish seed as the cell trendDirection."""

    def _snapshot(self, bars: list[SignalMatrixBarInput]) -> dict:
        from pyrus_compute.jobs import _evaluate_signal_cell, _signal_indicator_snapshot

        settings = SignalMatrixSettingsInput()
        evaluation = _evaluate_signal_cell(bars, settings)
        snapshot = _signal_indicator_snapshot(bars, evaluation, settings, None)
        assert snapshot is not None
        return snapshot

    def test_short_window_trend_direction_is_none(self) -> None:
        from pyrus_compute.jobs import _evaluate_signal_cell

        bars = _downtrend_bars(50)  # < basisLength(80) + 5
        settings = SignalMatrixSettingsInput()
        evaluation = _evaluate_signal_cell(bars, settings)
        assert evaluation["trendBasisComputable"] is False
        # Series still carries its bullish seed — the flag is what protects us.
        assert evaluation["trendDirection"][-1] == 1
        assert self._snapshot(bars)["trendDirection"] is None

    def test_warmed_window_reports_measured_bearish_trend(self) -> None:
        from pyrus_compute.jobs import _evaluate_signal_cell

        bars = _downtrend_bars(240)
        settings = SignalMatrixSettingsInput()
        evaluation = _evaluate_signal_cell(bars, settings)
        assert evaluation["trendBasisComputable"] is True
        assert self._snapshot(bars)["trendDirection"] == "bearish"
