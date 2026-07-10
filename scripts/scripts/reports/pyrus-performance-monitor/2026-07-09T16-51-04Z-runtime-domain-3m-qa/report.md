# PYRUS 15-Minute Performance Monitor

- Window: 2026-07-09T16:51:10.319Z to 2026-07-09T16:54:04.357Z
- Samples: 36
- Verdict: WARNING
- Reasons: Latest diagnostics severity is warning. 3 sampled endpoint(s) had failures.

## Optimization Candidates
- Investigate slow route /accounts/shadow/closed-trades: p95 13846ms, max 13846ms.
- Reduce API event-loop stalls; max observed 1502.6ms.
- Review API memory/cache pressure; RSS peaked at 2017.7 MB.
- Start with resource-pressure driver API latency (13846 ms).

## API Runtime
- API p95 latency min/avg/max: 3064ms / 3776.472ms / 5677ms
- API p99 latency min/avg/max: 13209ms / 13507.333ms / 13746ms
- Event loop p95 min/avg/max: 130.6ms / 276.783ms / 556.3ms
- Event loop max min/avg/max: 407.1ms / 847.25ms / 1502.6ms
- Heap used min/avg/max: 675.6 MB / 1151.003 MB / 1725.9 MB
- RSS min/avg/max: 1689.3 MB / 1918.217 MB / 2017.7 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /accounts/shadow/closed-trades | 13846ms | 13846ms | 5 |
| /accounts/shadow/tax/overview | 13746ms | 13746ms | 1 |
| /signal-monitor/events | 13209ms | 13209ms | 9 |
| /accounts/shadow/equity-history | 6547ms | 6547ms | 6 |
| /watchlists | 4891ms | 4891ms | 2 |
| /signal-monitor/profile | 4266ms | 4266ms | 1 |
| /accounts/shadow/tax/events | 3998ms | 3998ms | 2 |
| /accounts/shadow/risk | 3556ms | 3556ms | 2 |

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
- Cgroup memory current min/avg/max: 6727 MB / 7193.889 MB / 7948 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 224378 | 103 MB / 103 MB / 103 MB | 7 / 7 / 7 | 20 / 20.028 / 21 | 8 |
| web | 224410 | 540 MB / 540 MB / 540 MB | 14 / 14 / 14 | 41 / 49.222 / 54 | 612 |
| api | 227106 | 1851 MB / 1937.639 MB / 2036 MB | 11 / 11 / 11 | 53 / 97.222 / 122 | 16483 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /diagnostics/latest | 36 | 0 | 1954ms | 2806ms |
| frontend:/api/healthz | 36 | 1 | 1495ms | 2503ms |
| /session | 6 | 0 | 1555ms | 1555ms |
| /healthz | 36 | 1 | 1712ms | 2503ms |
| /diagnostics/runtime | 36 | 0 | 3988ms | 4080ms |
| /diagnostics/events | 1 | 1 | 493ms | 493ms |

## Diagnostics Events
- accounts warning: Read-only account/order diagnostics probe failed
- storage warning: Postgres storage usage is approaching the configured limit.
- resource-pressure warning: DB pool waiting 1count breached warning threshold
- automation warning: Automation scan age 169202ms breached warning threshold
- api warning: API p95 latency 3196ms breached warning threshold
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
- runtime warning: Previous Replit/PYRUS run classified as api child exit.
- runtime warning: Previous Replit/PYRUS run classified as container replaced.
- runtime warning: Previous Replit/PYRUS run classified as web child exit.
- runtime warning: Previous Replit/PYRUS run classified as suspected resource pressure.
