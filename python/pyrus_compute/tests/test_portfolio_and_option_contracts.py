import pytest
from pydantic import ValidationError

from pyrus_compute.black_scholes import black_scholes_price
from pyrus_compute.jobs import run_greek_scenario_matrix, run_portfolio_optimization
from pyrus_compute.models import GreekScenarioMatrixInput, PortfolioOptimizationInput


def test_zero_shock_black_scholes_put_preserves_negative_rate_price() -> None:
    mark = black_scholes_price(
        spot=1,
        strike=100,
        time_to_expiration_years=1,
        volatility=0.2,
        right="put",
        risk_free_rate=-0.01,
    )
    request = GreekScenarioMatrixInput.model_validate(
        {
            "positions": [
                {
                    "symbol": "TEST-P100",
                    "underlying": "TEST",
                    "spot": 1,
                    "strike": 100,
                    "right": "put",
                    "markPrice": mark,
                    "daysToExpiration": 365,
                    "impliedVolatility": 0.2,
                    "riskFreeRate": -0.01,
                    "pricingModel": "black_scholes",
                }
            ],
            "spotShocks": [0],
            "ivShocks": [0],
            "dayOffsets": [0],
        }
    )

    result, _warnings = run_greek_scenario_matrix(request)

    assert result["scenarios"][0]["estimatedPnl"] == 0


def test_zero_greek_sum_is_adjusted_to_the_option_value_bound() -> None:
    request = GreekScenarioMatrixInput.model_validate(
        {
            "positions": [
                {
                    "symbol": "TEST-C50",
                    "underlying": "TEST",
                    "quantity": 1,
                    "multiplier": 100,
                    "spot": 100,
                    "strike": 50,
                    "right": "call",
                    "markPrice": 50,
                    "pricingModel": "bounded_greek_approximation",
                }
            ],
            "spotShocks": [-1],
            "ivShocks": [0],
            "dayOffsets": [0],
        }
    )

    result, _warnings = run_greek_scenario_matrix(request)
    scenario = result["scenarios"][0]

    assert scenario["estimatedPnl"] == -5_000
    assert scenario["boundedPositionCount"] == 1
    assert scenario["components"]["boundAdjustment"] == -5_000


def test_impossible_observed_option_mark_does_not_fabricate_repriced_pnl() -> None:
    request = GreekScenarioMatrixInput.model_validate(
        {
            "positions": [
                {
                    "symbol": "SPY-C100",
                    "underlying": "SPY",
                    "spot": 100,
                    "strike": 100,
                    "right": "call",
                    "markPrice": 150,
                    "daysToExpiration": 30,
                    "pricingModel": "black_scholes",
                }
            ],
            "spotShocks": [0],
            "ivShocks": [0],
            "dayOffsets": [0],
        }
    )

    try:
        result, warnings = run_greek_scenario_matrix(request)
    except ValueError as error:
        assert "mark" in str(error).lower() and "price" in str(error).lower()
        return

    assert any(
        "mark" in warning.lower() and ("outside" in warning.lower() or "invalid" in warning.lower())
        for warning in warnings
    )
    assert result["scenarioCount"] == 0 or all(
        scenario["repricedPositionCount"] == 0 and scenario["estimatedPnl"] == 0
        for scenario in result["scenarios"]
    )


def test_zero_intrinsic_positive_option_mark_is_rejected_before_repricing() -> None:
    request = GreekScenarioMatrixInput.model_validate(
        {
            "positions": [
                {
                    "symbol": "SPY-C50",
                    "underlying": "SPY",
                    "spot": 100,
                    "strike": 50,
                    "right": "call",
                    "markPrice": 0,
                    "daysToExpiration": 30,
                    "impliedVolatility": 0.2,
                    "pricingModel": "black_scholes",
                }
            ],
            "spotShocks": [0],
            "ivShocks": [0],
            "dayOffsets": [0],
        }
    )

    with pytest.raises(ValueError, match="mark price"):
        run_greek_scenario_matrix(request)


def test_symmetric_indefinite_covariance_is_rejected_before_zero_risk_is_reported() -> None:
    with pytest.raises((ValidationError, ValueError)):
        request = PortfolioOptimizationInput.model_validate(
            {
                "positions": [{"symbol": "A"}, {"symbol": "B"}],
                "covariance": [[1, -2], [-2, 1]],
            }
        )
        run_portfolio_optimization(request)


def test_near_indefinite_covariance_is_rejected_instead_of_clamped_to_zero_risk() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [
                {"symbol": "A", "currentWeight": 0.5},
                {"symbol": "B", "currentWeight": -0.5},
            ],
            "covariance": [[1, 1.000000000001], [1.000000000001, 1]],
            "constraints": {"longOnly": False, "maxTurnover": 0},
        }
    )

    with pytest.raises(ValueError, match="positive semidefinite"):
        run_portfolio_optimization(request)


def test_allocator_identifies_inverse_variance_advisory_method() -> None:
    result, warnings = run_portfolio_optimization(
        PortfolioOptimizationInput.model_validate(
            {
                "positions": [{"symbol": "LOW_VAR"}, {"symbol": "HIGH_VAR"}],
                "covariance": [[1, 0], [0, 4]],
                "objective": "min_variance",
            }
        )
    )

    proposed = {row["symbol"]: row["proposedWeight"] for row in result["allocations"]}
    assert proposed == {"LOW_VAR": 0.8, "HIGH_VAR": 0.2}
    method_metadata = " ".join(
        str(result.get(key, "")) for key in ("method", "allocationMethod", "methodology")
    ).lower()
    assert "inverse" in method_metadata and "variance" in method_metadata
    assert any("advisory" in warning.lower() for warning in warnings)


def test_infeasible_max_weight_constraint_fails_closed() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [{"symbol": "A"}, {"symbol": "B"}],
            "covariance": [[1, 0], [0, 1]],
            "constraints": {"maxWeight": 0.4},
        }
    )

    try:
        result, _warnings = run_portfolio_optimization(request)
    except ValueError:
        return

    assert all(row["proposedWeight"] <= 0.4 + 1e-9 for row in result["allocations"])


def test_allow_short_turnover_constraint_is_satisfied_or_fails_closed() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [
                {"symbol": "SHORT", "currentWeight": -0.5},
                {"symbol": "LONG", "currentWeight": 0.5},
            ],
            "covariance": [[1, 0], [0, 1]],
            "constraints": {"longOnly": False, "maxTurnover": 0.25},
        }
    )

    try:
        result, _warnings = run_portfolio_optimization(request)
    except ValueError:
        return

    assert result["turnover"] <= 0.25 + 1e-9
    assert sum(abs(row["proposedWeight"]) for row in result["allocations"]) == pytest.approx(1)
    assert result["concentration"]["effectivePositionCount"] <= len(result["allocations"])


def test_long_only_rejects_negative_current_weights_instead_of_falsifying_turnover() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [
                {"symbol": "SHORT", "currentWeight": -0.5},
                {"symbol": "LONG", "currentWeight": 0.5},
            ],
            "covariance": [[1, 0], [0, 1]],
            "constraints": {"longOnly": True, "maxTurnover": 0},
        }
    )

    with pytest.raises(ValueError, match="negative current weights"):
        run_portfolio_optimization(request)


def test_short_dominant_allocation_reports_the_absolute_top_symbol() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [
                {"symbol": "SHORT", "currentWeight": -0.8},
                {"symbol": "LONG", "currentWeight": 0.2},
            ],
            "covariance": [[1, 0], [0, 1]],
            "constraints": {"longOnly": False, "maxTurnover": 0},
        }
    )

    result, _warnings = run_portfolio_optimization(request)

    assert result["concentration"]["maxWeight"] == 0.8
    assert result["concentration"]["topSymbol"] == "SHORT"


def test_turnover_rejects_non_fully_invested_supplied_baseline() -> None:
    request = PortfolioOptimizationInput.model_validate(
        {
            "positions": [
                {"symbol": "A", "currentWeight": 0.4},
                {"symbol": "B", "currentWeight": 0.4},
            ],
            "covariance": [[1, 0], [0, 1]],
            "constraints": {"longOnly": True, "maxTurnover": 0},
        }
    )

    with pytest.raises(ValueError, match="fully invested"):
        run_portfolio_optimization(request)
