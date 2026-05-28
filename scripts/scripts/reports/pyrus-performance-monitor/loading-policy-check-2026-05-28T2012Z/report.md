# PYRUS 15-Minute Performance Monitor

- Window: 2026-05-28T20:12:59.852Z to 2026-05-28T20:13:20.159Z
- Samples: 5
- Verdict: CRITICAL
- Reasons: Latest diagnostics severity is critical. 6 sampled endpoint(s) had failures. Resource pressure reached critical.

## Optimization Candidates
- Investigate slow route /accounts/shadow/positions: p95 30230ms, max 30230ms.
- Reduce API event-loop stalls; max observed 13631.5ms.
- Review API memory/cache pressure; RSS peaked at 2069.3 MB.
- Start with resource-pressure driver API RSS (2069 MB).
- Inspect client long tasks; browser observer saw 33 cumulative long tasks.

## API Runtime
- API p95 latency min/avg/max: 8141ms / 8141ms / 8141ms
- API p99 latency min/avg/max: 16449ms / 16449ms / 16449ms
- Event loop p95 min/avg/max: 190.4ms / 193.833ms / 200.7ms
- Event loop max min/avg/max: 13631.5ms / 13631.5ms / 13631.5ms
- Heap used min/avg/max: 1245.2 MB / 1373.367 MB / 1629.7 MB
- RSS min/avg/max: 2034.6 MB / 2046.167 MB / 2069.3 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /accounts/shadow/positions | 30230ms | 30230ms | 7 |
| /signal-monitor/matrix | 16449ms | 16449ms | 3 |
| /accounts/U24762790/allocation | 15875ms | 15875ms | 7 |
| /accounts/U24762790/summary | 10914ms | 10914ms | 6 |
| /settings/preferences | 10534ms | 10534ms | 2 |
| /signal-monitor/state | 8970ms | 8970ms | 1 |
| /bars | 8782ms | 10638ms | 15 |
| /signal-monitor/events | 8099ms | 8099ms | 3 |

## Browser Observer
- Enabled: yes
- Launch error: none
- JS heap min/avg/max: 40 MB / 77.4 MB / 101 MB
- API timing count min/avg/max: 0 / 15.2 / 22
- Long task count min/avg/max: 4 / 19 / 33
- Page errors: 0
- Console errors: 2
- Request failures: 0

## IBKR And Market Data
- Line utilization min/avg/max: 0.015 / 0.107 / 0.13
- Admission active lines min/avg/max: 3 / 21.4 / 26
- Bridge active lines min/avg/max: 20 / 22.4 / 23
- Drift min/avg/max: -17 / -1 / 3
- Scheduler pressure states: normal, degraded

## Resource Pressure
- Levels observed: critical
- Cgroup memory current min/avg/max: 7686 MB / 8132 MB / 8356 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 117074 | 90 MB / 90 MB / 90 MB | 7 / 7 / 7 | 20 / 20 / 20 | 0 |
| api | 117113 | 1992 MB / 1997.2 MB / 2004 MB | 11 / 11 / 11 | 54 / 65.8 / 72 | 1838 |
| web | 117179 | 663 MB / 663.2 MB / 664 MB | 20 / 20 / 20 | 68 / 78 / 84 | 33 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /healthz | 5 | 2 | 2503ms | 2503ms |
| frontend:/api/healthz | 5 | 2 | 2501ms | 2501ms |
| /diagnostics/latest | 5 | 2 | 5002ms | 5002ms |
| /session | 3 | 1 | 5002ms | 5002ms |
| /diagnostics/runtime | 5 | 0 | 6800ms | 6800ms |
| /settings/ibkr-line-usage | 5 | 0 | 6810ms | 6810ms |
| /settings/ibkr-lanes | 3 | 2 | 10001ms | 10001ms |
| /diagnostics/events | 1 | 1 | 5002ms | 5002ms |

## Diagnostics Events
- automation warning: Signal-options scans are blocked by IB Gateway readiness.
- automation warning: Automation Gateway blocks 1count breached warning threshold
- api critical: API p95 latency 8141ms breached critical threshold
- orders warning: Open-orders snapshot timed out; using cached order stream.
- market-data warning: Option chain is degraded or stale.
- isolation warning: coep report for https://replit.com/public/js/replit-bridge.js
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
