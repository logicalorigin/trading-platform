# PYRUS 15-Minute Performance Monitor

- Window: 2026-07-09T15:45:04.051Z to 2026-07-09T15:50:02.385Z
- Samples: 61
- Verdict: WARNING
- Reasons: Latest diagnostics severity is warning. 4 sampled endpoint(s) had failures.

## Optimization Candidates
- Investigate slow route /signal-monitor/profile: p95 20336ms, max 20336ms.
- Reduce API event-loop stalls; max observed 1701.8ms.
- Review API memory/cache pressure; RSS peaked at 2116.9 MB.
- Start with resource-pressure driver API latency (20336 ms).

## API Runtime
- API p95 latency min/avg/max: 4481ms / 6297.617ms / 7025ms
- API p99 latency min/avg/max: 4481ms / 16578.117ms / 20336ms
- Event loop p95 min/avg/max: 79ms / 364.068ms / 1458.6ms
- Event loop max min/avg/max: 221.9ms / 1101.325ms / 1701.8ms
- Heap used min/avg/max: 497.5 MB / 1071.538 MB / 1753.4 MB
- RSS min/avg/max: 762.6 MB / 1882.452 MB / 2116.9 MB

## Slow Routes
| Route | P95 | Max | Slow Count |
| --- | --- | --- | --- |
| /signal-monitor/profile | 20336ms | 20336ms | 5 |
| /accounts/shadow/orders | 20127ms | 20127ms | 2 |
| /signal-monitor/events | 18952ms | 18952ms | 10 |
| /accounts/shadow/tax/overview | 13507ms | 13507ms | 1 |
| /accounts/shadow/allocation | 10357ms | 10357ms | 2 |
| /watchlists | 10208ms | 10208ms | 3 |
| /accounts/shadow/closed-trades | 10078ms | 10078ms | 3 |
| /accounts/shadow/equity-history | 8291ms | 8291ms | 5 |

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
- Cgroup memory current min/avg/max: 6234 MB / 7104.098 MB / 8705 MB
- Cgroup memory max: 16384 MB

## Processes
| Role | PID | RSS min/avg/max | Threads | FDs | CPU ticks Δ |
| --- | --- | --- | --- | --- | --- |
| supervisor | 188269 | 110 MB / 110 MB / 110 MB | 7 / 7 / 7 | 20 / 20 / 20 | 14 |
| api | 188337 | 1673 MB / 1942.836 MB / 2128 MB | 11 / 11 / 11 | 87 / 101.066 / 148 | 22590 |
| web | 188350 | 474 MB / 485.59 MB / 528 MB | 14 / 14 / 14 | 36 / 45.115 / 51 | 1095 |

## Endpoint Sampling
| Endpoint | Calls | Fail | P95 | Max |
| --- | --- | --- | --- | --- |
| /healthz | 61 | 5 | 2501ms | 2545ms |
| /diagnostics/latest | 61 | 1 | 2851ms | 5002ms |
| frontend:/api/healthz | 61 | 3 | 2411ms | 2505ms |
| /session | 11 | 0 | 2443ms | 2443ms |
| /diagnostics/runtime | 61 | 0 | 4917ms | 5499ms |
| /diagnostics/events | 1 | 1 | 472ms | 472ms |

## Diagnostics Events
- resource-pressure warning: DB pool waiting 14count breached warning threshold
- api warning: API p95 latency 6278ms breached warning threshold
- storage warning: Postgres storage usage is approaching the configured limit.
- runtime warning: Previous Replit/PYRUS run classified as same container supervisor abrupt.
- runtime warning: Previous Replit/PYRUS run classified as container replaced.
- runtime warning: Previous Replit/PYRUS run classified as api child exit.
- runtime warning: Previous Replit/PYRUS run classified as web child exit.
- runtime warning: Previous Replit/PYRUS run classified as suspected resource pressure.
