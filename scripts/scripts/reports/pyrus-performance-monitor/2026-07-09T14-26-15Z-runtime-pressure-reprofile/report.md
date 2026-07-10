# PYRUS 15-Minute Performance Monitor

- Window: 2026-07-09T14:26:19.854Z to 2026-07-09T14:41:21.028Z
- Samples: 181
- Verdict: WARNING
- Reasons: Latest diagnostics severity is warning. 5 sampled endpoint(s) had failures.

## Optimization Candidates
- Investigate slow route /accounts/shadow/tax/overview: p95 19634ms, max 19634ms.
- Reduce API event-loop stalls; max observed 2732.6ms.
- Review API memory/cache pressure; RSS peaked at 2291.8 MB.
- Start with resource-pressure driver API latency (12802 ms).

## API Runtime
- API p95 latency min/avg/max: 1629ms / 5455.569ms / 9054ms
- API p99 latency min/avg/max: 1629ms / 11899.54ms / 19436ms
- Event loop p95 min/avg/max: 0ms / 179.632ms / 514.3ms
- Event loop max min/avg/max: 0ms / 1028.948ms / 2732.6ms
- Heap used min/avg/max: 149.1 MB / 1205.769 MB / 1726.2 MB
- RSS min/avg/max: 380 MB / 1960.376 MB / 2291.8 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /accounts/shadow/tax/overview | 19634ms | 19634ms | 1 |
| /accounts/shadow/tax/events | 19436ms | 19436ms | 2 |
| /accounts/shadow/summary | 18309ms | 18309ms | 2 |
| /accounts/73025d5d-2a63-4700-ad48-fb84aa08fa6f/summary | 18001ms | 18001ms | 1 |
| /tax/reserve | 17985ms | 17985ms | 2 |
| /accounts/73025d5d-2a63-4700-ad48-fb84aa08fa6f/allocation | 14717ms | 14717ms | 1 |
| /accounts/9197da68-4c3d-419d-9dc6-874589a05245/tax/overview | 13042ms | 13042ms | 1 |
| /signal-monitor/events | 12802ms | 12802ms | 6 |

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
- Levels observed: high
- Cgroup memory current min/avg/max: 3956 MB / 6601.365 MB / 7775 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 78528 | 108 MB / 108.371 MB / 112 MB | 7 / 7 / 7 | 20 / 20 / 20 | 30 |
| api | 78568 | 1826 MB / 2055.405 MB / 2295 MB | 11 / 11 / 11 | 49 / 93.172 / 146 | 50930 |
| web | 78576 | 559 MB / 561.241 MB / 564 MB | 14 / 14 / 14 | 36 / 44.086 / 50 | 1563 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /healthz | 181 | 3 | 1207ms | 2503ms |
| /diagnostics/latest | 181 | 2 | 1995ms | 4562ms |
| frontend:/api/healthz | 181 | 6 | 2064ms | 2512ms |
| /session | 31 | 0 | 3797ms | 4510ms |
| /diagnostics/runtime | 181 | 4 | 3808ms | 8011ms |
| /diagnostics/events | 1 | 1 | 321ms | 321ms |

## Diagnostics Events
- resource-pressure warning: DB pool waiting 29count breached warning threshold
- automation warning: Automation scan failures 1count breached warning threshold
- api warning: API p95 latency 9054ms breached warning threshold
- storage warning: Postgres storage usage is approaching the configured limit.
- automation warning: Signal-options worker scan timed out for 7e2e4e6f-749f-4e65-a011-87d3559a23b0 after 120000ms.
- automation warning: Signal-options worker scans are stale or the worker is stopped.
- browser warning: deploymentListEmptyUnavailable is not defined
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
- runtime warning: Previous Replit/PYRUS run classified as container replaced.
- runtime warning: Previous Replit/PYRUS run classified as api child exit.
- runtime warning: Previous Replit/PYRUS run classified as web child exit.
- runtime warning: Previous Replit/PYRUS run classified as suspected resource pressure.
