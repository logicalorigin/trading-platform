# PYRUS Compute

Internal Python compute service for batch math and research workloads.

## Role

- Python owns scientific/batch math where NumPy, SciPy, Polars, or Arrow are useful.
- TypeScript still owns API orchestration, shared app formulas, and UI-compatible logic.
- Rust still owns market-data ingestion, queue draining, and GEX hot-path calculation.

## Commands

From the repo root:

```bash
pnpm run python-compute:doctor
pnpm run python-compute:benchmark
pnpm run python-compute:test
pnpm run python-compute:lint
pnpm run python-compute:typecheck
```

The API server starts this service only when `PYRUS_PYTHON_COMPUTE_ENABLED=1`.
By default it binds to `127.0.0.1:18768`.

## Jobs

- `benchmark_matrix`: synthetic benchmark slices for account, backtest, signal,
  option exposure, and portfolio covariance-style workloads.
- `greek_scenario_matrix`: option-position scenario analytics across spot shocks,
  implied-volatility shocks, and time decay using delta/gamma/theta/vega.
- `portfolio_optimization`: advisory-only allocation, risk contribution,
  turnover, and concentration analytics.
- `portfolio_risk`: portfolio exposure, concentration, scenario, covariance, and
  correlation analytics.
