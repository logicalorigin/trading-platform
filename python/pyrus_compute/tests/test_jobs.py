from __future__ import annotations

import math

import pytest

from pyrus_compute.black_scholes import black_scholes
from pyrus_compute.jobs import run_job
from pyrus_compute.models import JobRequest


def test_benchmark_matrix_returns_named_metrics() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="benchmark_matrix",
            input={"rows": 500, "trials": 1, "seed": 7},
        )
    )

    assert warnings == []
    metric_names = {entry["name"] for entry in result["metrics"]}
    assert "account_return_series_numpy" in metric_names
    assert "option_gex_vector_numpy" in metric_names
    assert result["rows"] == 500


def test_portfolio_risk_computes_exposure_and_covariance() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="portfolio_risk",
            input={
                "positions": [
                    {"symbol": "SPY", "quantity": 10, "price": 500, "delta": 1, "sector": "ETF"},
                    {"symbol": "QQQ", "quantity": -5, "price": 450, "delta": 0.8, "sector": "ETF"},
                ],
                "returns": [
                    {"symbol": "SPY", "values": [0.01, -0.02, 0.03, 0.01]},
                    {"symbol": "QQQ", "values": [0.02, -0.01, 0.025, 0.005]},
                ],
                "shocks": [-0.05, 0.05],
            },
        )
    )

    assert warnings == []
    assert result["grossExposure"] == 7250
    assert result["netExposure"] == 2750
    assert result["deltaAdjustedExposure"] == 3200
    assert result["correlationSymbols"] == ["SPY", "QQQ"]
    assert result["correlation"] is not None
    assert result["scenarios"][0]["estimatedPnl"] == -160


def test_portfolio_optimization_returns_empty_advisory_result() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="portfolio_optimization",
            input={"positions": []},
        )
    )

    assert warnings == ["portfolio_optimization received no positions"]
    assert result["advisoryOnly"] is True
    assert result["allocations"] == []
    assert result["turnover"] == 0
    assert result["warnings"] == ["portfolio_optimization received no positions"]


def test_portfolio_optimization_prefers_lower_variance_assets_deterministically() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="portfolio_optimization",
            input={
                "positions": [
                    {"symbol": "LOWVOL", "currentWeight": 0.5},
                    {"symbol": "HIGHVOL", "currentWeight": 0.5},
                ],
                "returns": [
                    {"symbol": "LOWVOL", "values": [0.01, 0.011, 0.009, 0.0105]},
                    {"symbol": "HIGHVOL", "values": [0.04, -0.03, 0.05, -0.02]},
                ],
                "objective": "min_variance",
            },
        )
    )

    allocations = {entry["symbol"]: entry for entry in result["allocations"]}
    assert warnings == []
    assert result["advisoryOnly"] is True
    assert result["objective"] == "min_variance"
    assert allocations["LOWVOL"]["proposedWeight"] > allocations["HIGHVOL"]["proposedWeight"]
    assert sum(entry["proposedWeight"] for entry in result["allocations"]) == pytest.approx(1)
    assert result["turnover"] > 0
    assert result["portfolioVolatility"] > 0


def test_portfolio_optimization_enforces_long_only_and_max_weight_constraints() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="portfolio_optimization",
            input={
                "positions": [
                    {"symbol": "A", "currentWeight": 0.6},
                    {"symbol": "B", "currentWeight": 0.3},
                    {"symbol": "C", "currentWeight": -0.1},
                ],
                "covariance": [
                    [0.0001, 0, 0],
                    [0, 0.01, 0],
                    [0, 0, 0.02],
                ],
                "constraints": {
                    "longOnly": True,
                    "maxWeight": 0.4,
                },
            },
        )
    )

    assert "negative current weights were clamped for long-only optimization" in warnings
    proposed_weights = [entry["proposedWeight"] for entry in result["allocations"]]
    assert max(proposed_weights) <= 0.4
    assert min(proposed_weights) >= 0
    assert sum(proposed_weights) == pytest.approx(1)
    assert result["concentration"]["maxWeight"] <= 0.4


def test_portfolio_optimization_warns_and_falls_back_for_invalid_covariance() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="portfolio_optimization",
            input={
                "positions": [
                    {"symbol": "A", "currentWeight": 0.5},
                    {"symbol": "B", "currentWeight": 0.5},
                ],
                "covariance": [[0.01]],
                "constraints": {
                    "maxWeight": 0.6,
                },
            },
        )
    )

    assert "invalid covariance matrix; using diagonal fallback" in warnings
    assert result["warnings"] == warnings
    assert len(result["allocations"]) == 2
    assert sum(entry["proposedWeight"] for entry in result["allocations"]) == pytest.approx(1)


def test_black_scholes_prices_call_put_and_greeks() -> None:
    call = black_scholes(
        spot=100,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="call",
        risk_free_rate=0.05,
    )
    put = black_scholes(
        spot=100,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="put",
        risk_free_rate=0.05,
    )

    assert call.price == pytest.approx(10.4506, abs=0.0001)
    assert put.price == pytest.approx(5.5735, abs=0.0001)
    assert call.delta == pytest.approx(0.6368, abs=0.0001)
    assert put.delta == pytest.approx(-0.3632, abs=0.0001)
    assert call.gamma == pytest.approx(0.018762, abs=0.000001)
    assert call.vega == pytest.approx(0.37524, abs=0.00001)
    assert call.price - put.price == pytest.approx(
        100 - 100 * math.exp(-0.05),
        abs=0.0001,
    )


def test_greek_scenario_matrix_combines_delta_gamma_theta_and_vega() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 500C",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 500,
                        "markPrice": 10,
                        "delta": 0.5,
                        "gamma": 0.02,
                        "theta": -0.1,
                        "vega": 0.2,
                        "greekScale": "per_contract",
                    }
                ],
                "spotShocks": [0.02],
                "ivShocks": [5],
                "dayOffsets": [1],
            },
        )
    )

    assert warnings == []
    assert result["scenarioCount"] == 1
    scenario = result["scenarios"][0]
    assert scenario["components"] == {
        "delta": 500.0,
        "gamma": 100.0,
        "theta": -10.0,
        "vega": 100.0,
    }
    assert scenario["estimatedPnl"] == 690.0
    assert result["positions"][0]["deltaShares"] == 50.0


def test_greek_scenario_matrix_reprices_complete_options_with_black_scholes() -> None:
    current = black_scholes(
        spot=100,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="call",
        risk_free_rate=0.05,
    )
    shocked = black_scholes(
        spot=110,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="call",
        risk_free_rate=0.05,
    )

    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 100C",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 100,
                        "markPrice": current.price,
                        "strike": 100,
                        "right": "call",
                        "impliedVolatility": 0.2,
                        "daysToExpiration": 365,
                        "riskFreeRate": 0.05,
                        "delta": 0,
                        "gamma": 0,
                        "theta": 0,
                        "vega": 0,
                    }
                ],
                "spotShocks": [0.1],
                "ivShocks": [0],
                "dayOffsets": [0],
            },
        )
    )

    expected_pnl = (shocked.price - current.price) * 100
    assert warnings == []
    assert result["pricingModel"] == "black_scholes"
    assert result["repricedPositionScenarioCount"] == 1
    assert result["fallbackPositionScenarioCount"] == 0
    assert result["positions"][0]["pricingModel"] == "black_scholes"
    assert result["positions"][0]["blackScholesVolatility"] == 0.2
    assert result["scenarios"][0]["repricedPositionCount"] == 1
    assert result["scenarios"][0]["components"] == {
        "repricing": round(expected_pnl, 6),
    }
    assert result["scenarios"][0]["estimatedPnl"] == round(expected_pnl, 6)


def test_greek_scenario_matrix_can_infer_black_scholes_volatility_from_mark() -> None:
    current = black_scholes(
        spot=100,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="put",
        risk_free_rate=0.05,
    )

    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 100P",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 100,
                        "markPrice": current.price,
                        "strike": 100,
                        "right": "put",
                        "daysToExpiration": 365,
                        "riskFreeRate": 0.05,
                        "delta": 0,
                        "gamma": 0,
                        "theta": 0,
                        "vega": 0,
                    }
                ],
                "spotShocks": [-0.1],
                "ivShocks": [0],
                "dayOffsets": [0],
            },
        )
    )

    assert warnings == []
    assert result["pricingModel"] == "black_scholes"
    assert result["positions"][0]["blackScholesVolatility"] == pytest.approx(0.2, abs=0.0001)
    assert result["positions"][0]["blackScholesVolatilitySource"] == "implied_from_mark"


def test_greek_scenario_matrix_uses_position_scaled_greeks_without_rescaling() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 500C x2",
                        "underlying": "SPY",
                        "quantity": 2,
                        "multiplier": 100,
                        "spot": 500,
                        "markPrice": 10,
                        "delta": 100,
                        "gamma": 4,
                        "theta": -20,
                        "vega": 40,
                        "greekScale": "position",
                    }
                ],
                "spotShocks": [0.02],
                "ivShocks": [5],
                "dayOffsets": [1],
            },
        )
    )

    assert warnings == []
    assert result["scenarioCount"] == 1
    assert result["positions"][0]["premiumExposure"] == 2000.0
    assert result["positions"][0]["deltaShares"] == 100.0
    assert result["positions"][0]["gammaUnits"] == 4.0
    assert result["positions"][0]["thetaPerDay"] == -20.0
    assert result["positions"][0]["vegaPerVolPoint"] == 40.0
    assert result["scenarios"][0]["components"] == {
        "delta": 1000.0,
        "gamma": 200.0,
        "theta": -20.0,
        "vega": 200.0,
    }
    assert result["scenarios"][0]["estimatedPnl"] == 1380.0


def test_greek_scenario_matrix_bounds_long_option_loss_at_premium() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 500C",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 100,
                        "markPrice": 10,
                        "delta": 1,
                        "gamma": 0,
                        "theta": 0,
                        "vega": 0,
                    }
                ],
                "spotShocks": [-0.2],
                "ivShocks": [0],
                "dayOffsets": [0],
            },
        )
    )

    assert warnings == []
    scenario = result["scenarios"][0]
    assert result["positions"][0]["premiumExposure"] == 1000.0
    assert scenario["estimatedPnl"] == -1000.0
    assert scenario["components"]["delta"] == -1000.0
    assert scenario["boundedPositionCount"] == 1
    assert result["boundedPositionScenarioCount"] == 1


def test_greek_scenario_matrix_bounds_short_option_gain_at_premium() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY short call",
                        "underlying": "SPY",
                        "quantity": -1,
                        "multiplier": 100,
                        "spot": 100,
                        "markPrice": 10,
                        "delta": 1,
                        "gamma": 0,
                        "theta": 0,
                        "vega": 0,
                    }
                ],
                "spotShocks": [-0.2],
                "ivShocks": [0],
                "dayOffsets": [0],
            },
        )
    )

    assert warnings == []
    scenario = result["scenarios"][0]
    assert result["positions"][0]["premiumExposure"] == 1000.0
    assert scenario["estimatedPnl"] == 1000.0
    assert scenario["components"]["delta"] == 1000.0
    assert scenario["boundedPositionCount"] == 1
    assert result["boundedPositionScenarioCount"] == 1


def test_greek_scenario_matrix_bounds_long_put_gain_at_strike() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY 50P",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 50,
                        "markPrice": 5,
                        "strike": 50,
                        "right": "put",
                        "delta": -10,
                        "gamma": 0,
                        "theta": 0,
                        "vega": 0,
                    }
                ],
                "spotShocks": [-1],
                "ivShocks": [0],
                "dayOffsets": [0],
            },
        )
    )

    assert warnings == []
    scenario = result["scenarios"][0]
    assert result["positions"][0]["premiumExposure"] == 500.0
    assert scenario["estimatedPnl"] == 4500.0
    assert scenario["components"]["delta"] == 4500.0
    assert scenario["boundedPositionCount"] == 1
    assert result["boundedPositionScenarioCount"] == 1


def test_greek_scenario_matrix_flags_position_management_pressure() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "SPY short straddle",
                        "underlying": "SPY",
                        "quantity": 1,
                        "multiplier": 100,
                        "spot": 500,
                        "markPrice": 8,
                        "delta": 0,
                        "gamma": -0.08,
                        "theta": -0.25,
                        "vega": -0.4,
                    }
                ],
                "spotShocks": [-0.05, 0.05],
                "ivShocks": [5],
                "dayOffsets": [1],
            },
        )
    )

    assert warnings == []
    flags = result["managementFlags"]
    assert flags[0]["symbol"] == "SPY short straddle"
    assert flags[0]["severityScore"] > 1
    assert "theta_burden" in flags[0]["reasons"]
    assert "short_gamma_convexity" in flags[0]["reasons"]
    assert "vega_sensitive" in flags[0]["reasons"]


def test_greek_scenario_matrix_defaults_cover_short_dated_option_stress() -> None:
    result, warnings = run_job(
        JobRequest(
            jobType="greek_scenario_matrix",
            input={
                "positions": [
                    {
                        "symbol": "MSFT weekly call",
                        "underlying": "MSFT",
                        "quantity": 3,
                        "multiplier": 100,
                        "spot": 450,
                        "markPrice": 10.5,
                        "delta": 194,
                        "gamma": 12.5,
                        "theta": -189,
                        "vega": 45.8,
                        "greekScale": "position",
                    }
                ],
            },
        )
    )

    assert warnings == []
    assert result["scenarioCount"] == 140
    assert {scenario["spotShock"] for scenario in result["scenarios"]} == {
        -0.08,
        -0.05,
        -0.02,
        0.0,
        0.02,
        0.05,
        0.08,
    }
    assert {scenario["ivShockVolPoints"] for scenario in result["scenarios"]} == {
        -10.0,
        -5.0,
        0.0,
        5.0,
        10.0,
    }
    assert {scenario["dayOffset"] for scenario in result["scenarios"]} == {
        0.0,
        1.0,
        3.0,
        5.0,
    }
