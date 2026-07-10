# PYRUS 15-Minute Performance Monitor

- Window: 2026-07-09T16:04:55.752Z to 2026-07-09T16:09:49.538Z
- Samples: 60
- Verdict: WARNING
- Reasons: Latest diagnostics severity is warning. 3 sampled endpoint(s) had failures.

## Optimization Candidates
- Investigate slow route /accounts/shadow/equity-history: p95 11389ms, max 11389ms.
- Reduce API event-loop stalls; max observed 1744.8ms.
- Review API memory/cache pressure; RSS peaked at 2032.7 MB.
- Start with resource-pressure driver API latency (11345 ms).

## API Runtime
- API p95 latency min/avg/max: 12ms / 4524.917ms / 5804ms
- API p99 latency min/avg/max: 12ms / 9539.7ms / 11389ms
- Event loop p95 min/avg/max: 0ms / 151.32ms / 274.2ms
- Event loop max min/avg/max: 0ms / 833.175ms / 1744.8ms
- Heap used min/avg/max: 215.8 MB / 1058.695 MB / 1526.3 MB
- RSS min/avg/max: 383.8 MB / 1752.197 MB / 2032.7 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /accounts/shadow/equity-history | 11389ms | 11389ms | 2 |
| /signal-monitor/events | 11345ms | 11345ms | 14 |
| /diagnostics/client-metrics | 10444ms | 10444ms | 5 |
| /signal-monitor/profile | 10279ms | 10279ms | 2 |
| /watchlists | 8935ms | 8935ms | 3 |
| /session | 6971ms | 6971ms | 5 |
| /sparklines/seed | 5961ms | 5961ms | 6 |
| /accounts/shadow/closed-trades | 5632ms | 5632ms | 2 |

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
- Levels observed: watch, high
- Cgroup memory current min/avg/max: 6070 MB / 7049.183 MB / 8928 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 205056 | 110 MB / 110.883 MB / 111 MB | 7 / 7 / 7 | 20 / 20 / 20 | 14 |
| api | 205197 | 962 MB / 1859.933 MB / 2049 MB | 11 / 11 / 11 | 62 / 103.133 / 240 | 22413 |
| web | 205205 | 512 MB / 512.917 MB / 523 MB | 14 / 14 / 14 | 44 / 46.167 / 52 | 829 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /healthz | 60 | 3 | 2483ms | 2501ms |
| frontend:/api/healthz | 60 | 2 | 2257ms | 2503ms |
| /session | 10 | 0 | 1574ms | 1574ms |
| /diagnostics/latest | 60 | 0 | 2485ms | 3292ms |
| /diagnostics/runtime | 60 | 0 | 4036ms | 5282ms |
| /diagnostics/events | 1 | 1 | 1745ms | 1745ms |

## Diagnostics Events
- automation warning: Automation scan age 190313ms breached warning threshold
- api warning: API p95 latency 4695ms breached warning threshold
- accounts warning: Read-only account/order diagnostics probe failed
- storage warning: Postgres storage usage is approaching the configured limit.
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
- runtime warning: Previous Replit/PYRUS run classified as container replaced.
- runtime warning: Previous Replit/PYRUS run classified as api child exit.
- runtime warning: Previous Replit/PYRUS run classified as web child exit.
- runtime warning: Previous Replit/PYRUS run classified as suspected resource pressure.
