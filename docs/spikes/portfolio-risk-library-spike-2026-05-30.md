# Portfolio Risk Library Spike

Date: 2026-05-30

Task: `docs/plans/awesome-quant-pyrus-improvements.md` Task 8.

## Decision

Do not add a portfolio/risk library dependency to `python/pyrus_compute` in this wave.

Keep the native `portfolio_optimization` job as the production path for now. It is already advisory-only, deterministic, broker-free, and live-validated. If Pyrus later needs true solver-backed min-volatility, CVaR, HERC, or cross-validated portfolio model selection, prefer a new `skfolio` spike behind an explicit versioned output contract.

## Source Check

| Candidate | Current version | License | Python support | Official notes |
| --- | ---: | --- | --- | --- |
| `skfolio` | `0.20.1` | BSD-3-Clause | `>=3.10` | PyPI describes it as portfolio optimization on top of scikit-learn, with mean-risk, risk budgeting, hierarchical methods, CVaR, constraints, turnover, and transaction-cost features. |
| `Riskfolio-Lib` | `7.2.1` | BSD-3-Clause | `>=3.9` | PyPI lists a broad optimization stack, but also a much heavier dependency set including `cvxpy`, `statsmodels`, `arch`, `astropy`, `pybind11`, and `vectorbt`. |
| `PyPortfolioOpt` | `1.6.0` | MIT | Python 3-only classifiers include 3.10-3.13 | Focused efficient-frontier/Black-Litterman-style optimizer. Smaller first-party wheel, but still pulls solver dependencies. |
| `empyrical-reloaded` | `0.5.12` | Apache-2.0 | `>=3.9` | Risk/performance metrics package, not a portfolio optimizer. Useful as a parity reference for Sharpe, drawdown, alpha/beta, and annualized volatility. |

Sources:

- https://pypi.org/project/skfolio/
- https://pypi.org/project/riskfolio-lib/
- https://pypi.org/project/pyportfolioopt/
- https://pypi.org/project/empyrical-reloaded/

## Local Measurement

Environment:

- Python: `3.11.14`
- `uv`: `0.9.5`
- Installs used isolated `/tmp/pyrus-portfolio-lib-*` target directories. Sizes are clean target sizes including shared dependencies, so they overstate incremental size versus the existing Python compute environment but accurately show cold dependency weight.

Baseline native `portfolio_optimization` sample:

| Symbol | Native proposed weight | Native risk contribution |
| --- | ---: | ---: |
| `SPY` | `0.266115` | `0.395133` |
| `QQQ` | `0.095210` | `0.250153` |
| `TLT` | `0.638676` | `0.354714` |

Native warnings: none.

Candidate measurements:

| Candidate | Isolated install | Import/runtime | Sample output | Notes |
| --- | ---: | --- | --- | --- |
| `skfolio==0.20.1` | `359 MiB`, `12.863s` | import `6504ms`; `MeanRisk.fit` `20ms`; `RiskBudgeting.fit` `11ms` | MeanRisk: `SPY 0.386896`, `QQQ 0.000020`, `TLT 0.613084`; RiskBudgeting: `SPY 0.224266`, `QQQ 0.125899`, `TLT 0.649835` | Best API fit for a future advanced optimizer. Rich model set and sklearn-style API, but import and dependency weight are high for the current advisory need. |
| `PyPortfolioOpt==1.6.0` | `361 MiB`, `1.188s` from warm cache | import `2991ms`; `EfficientFrontier.min_volatility` `13ms` | Min volatility: `SPY 0.386617`, `QQQ 0.000203`, `TLT 0.613180` | Good focused solver for efficient frontier. Less comprehensive than `skfolio` for future risk-budgeting/CVaR/HERC requirements. |
| `Riskfolio-Lib==7.2.1` | `825 MiB`, `4.516s` from warm cache | import `7507ms`; `Portfolio.optimization` `34ms` | Min risk: `SPY 0.386908`, `QQQ 0.000000`, `TLT 0.613091` | Heaviest dependency by a wide margin. Sample printed a positive-definite covariance warning on this small fixture. Keep as reference/alternate only. |
| `empyrical-reloaded==0.5.12` | initial isolated import failed | import failed without undeclared `pytz` | `ModuleNotFoundError: No module named 'pytz'` | Not an optimizer. With explicit `pytz`, isolated target was `216 MiB`, import `2314ms`, metrics calc `0.38ms`; useful only as a risk-metric parity reference. |

`empyrical-reloaded+pytz` sample metrics for the SPY fixture:

- annual volatility: `0.0610704511`
- Sharpe ratio: `8.2527636649`
- max drawdown: `-0.004`
- final cumulative return: `0.0120228153`

## Interpretation

The native Pyrus job currently behaves more like inverse-variance advisory allocation than a full-covariance efficient-frontier optimizer. `skfolio`, `PyPortfolioOpt`, and `Riskfolio-Lib` all drove the tiny sample toward near-zero `QQQ` because they solved against the full covariance matrix. That is a meaningful semantic difference. We should not silently replace native output without a versioned response contract and UI copy review.

For the current product need, the native implementation wins:

- no new dependency or solver stack;
- deterministic output;
- no broker/order path;
- already covered by Python compute tests;
- already live-validated through the read-only inspector.

For future product needs:

- Prefer `skfolio` if Pyrus needs solver-backed portfolio optimization, risk budgeting, CVaR, HERC, cross-validation, model selection, or richer constraint support.
- Use `PyPortfolioOpt` only if we need a narrower efficient-frontier API with less conceptual surface.
- Avoid `Riskfolio-Lib` as a first-wave dependency because of install size and heavy dependency footprint.
- Keep `empyrical-reloaded` as a parity/reference source for performance metrics, not allocation.

## Follow-Up

If Task 10 moves forward before advanced optimizer needs are proven, expose the native job only as advisory allocation diagnostics. Label the objective honestly and keep any suggested allocation copy away from trade-ticket semantics.
