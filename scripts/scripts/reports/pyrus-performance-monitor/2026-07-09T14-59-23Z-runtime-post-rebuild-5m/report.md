# PYRUS 15-Minute Performance Monitor

- Window: 2026-07-09T14:59:30.233Z to 2026-07-09T15:04:24.490Z
- Samples: 60
- Verdict: WARNING
- Reasons: Latest diagnostics severity is warning. 5 sampled endpoint(s) had failures.

## Optimization Candidates
- Investigate slow route /diagnostics/runtime: p95 2511ms, max 2511ms.
- Reduce API event-loop stalls; max observed 1477.4ms.
- Review API memory/cache pressure; RSS peaked at 1867.4 MB.
- Start with resource-pressure driver API latency (2598 ms).

## API Runtime
- API p95 latency min/avg/max: 23ms / 4432ms / 15820ms
- API p99 latency min/avg/max: 23ms / 9123.481ms / 15820ms
- Event loop p95 min/avg/max: 0ms / 126.871ms / 381.4ms
- Event loop max min/avg/max: 0ms / 574.958ms / 1477.4ms
- Heap used min/avg/max: 191.8 MB / 879.26 MB / 1405.6 MB
- RSS min/avg/max: 366 MB / 1439.794 MB / 1867.4 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /diagnostics/runtime | 2511ms | 2511ms | 6 |
| /auth/session | 1399ms | 1399ms | 1 |
| /signal-monitor/profile | 566ms | 566ms | 0 |
| /settings/preferences | 557ms | 557ms | 0 |
| /universe/logos | 338ms | 338ms | 0 |
| /watchlists | 247ms | 247ms | 0 |
| /accounts | 217ms | 217ms | 0 |
| /quotes/snapshot | 138ms | 138ms | 0 |

## Browser Observer
- Enabled: no
- Launch error: none
- JS heap min/avg/max: n/a
- API timing count min/avg/max: n/a
- Long task count min/avg/max: n/a
- Page errors: 0
- Console errors: 0
- Request failures: 0

## Resource Pressure
- Levels observed: high, normal
- Cgroup memory current min/avg/max: 5988 MB / 7732.9 MB / 8956 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 112216 | 100 MB / 102.225 MB / 104 MB | 7 / 7 / 7 | 20 / 20 / 20 | 11 |
| api | 112254 | 1677 MB / 1784.125 MB / 1872 MB | 11 / 11.3 / 13 | 42 / 76.875 / 132 | 11561 |
| web | 112262 | 222 MB / 289.875 MB / 453 MB | 14 / 14 / 14 | 32 / 35.05 / 38 | 69 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /healthz | 60 | 2 | 767ms | 1442ms |
| /diagnostics/latest | 60 | 2 | 1314ms | 1784ms |
| /session | 10 | 0 | 1304ms | 1304ms |
| frontend:/api/healthz | 60 | 5 | 1830ms | 2502ms |
| /diagnostics/runtime | 60 | 2 | 3493ms | 5858ms |
| /diagnostics/events | 1 | 1 | 11ms | 11ms |

## Diagnostics Events
- storage warning: Postgres storage usage is approaching the configured limit.
- resource-pressure warning: DB pool waiting 25count breached warning threshold
- api warning: API p95 latency 1595ms breached warning threshold
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
- runtime warning: Previous Replit/PYRUS run classified as container replaced.
- runtime warning: Previous Replit/PYRUS run classified as api child exit.
- runtime warning: Previous Replit/PYRUS run classified as web child exit.
- runtime warning: Previous Replit/PYRUS run classified as suspected resource pressure.
