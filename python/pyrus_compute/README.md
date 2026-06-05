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

The API server can start the same service binary in separate compute lanes:

- risk: `PYRUS_PYTHON_RISK_COMPUTE_ENABLED=1`, default port `18768`.
- research/chart: `PYRUS_PYTHON_RESEARCH_COMPUTE_ENABLED=1`, default port `18770`.
- backtest: `PYRUS_PYTHON_BACKTEST_COMPUTE_ENABLED=1`, default port `18771`.

The legacy `PYRUS_PYTHON_COMPUTE_ENABLED=1` flag still enables the risk lane.
Use `PYRUS_PYTHON_COMPUTE_GLOBAL_MAX_ACTIVE_JOBS` to cap active jobs across
all lanes.

Production callers are opt-in per workload. Account option Greek scenarios use
`PYRUS_PYTHON_GREEK_SCENARIOS_ENABLED=1`; account portfolio-risk notional
offload uses `PYRUS_PYTHON_PORTFOLIO_RISK_ENABLED=1`. Both require the owning
compute lane to be enabled.

## Jobs

- `benchmark_matrix`: synthetic benchmark slices for account, backtest, signal,
  option exposure, and portfolio covariance-style workloads.
- `greek_scenario_matrix`: option-position scenario analytics across spot shocks,
  implied-volatility shocks, and time decay using delta/gamma/theta/vega.
- `portfolio_optimization`: advisory-only allocation, risk contribution,
  turnover, and concentration analytics.
- `portfolio_risk`: portfolio exposure, concentration, scenario, covariance, and
  correlation analytics.
