# WO-AUTO-HEALTH — automation failure warning + failed ingest jobs + scanner lag verdict (tasks #3/#4/#5)

Dispatched by Claude session 26888663 (2026-07-09 ~13:40 MDT), Riley-approved. Worker: codex sol.
Report to: `.codex-watch/wo-automation-health-report.md`. STRICTLY READ-ONLY: no file edits (except
the report), psql SELECT only — recommend retries/fixes, do not execute them. NOTE:
signal-options-automation.ts and signal-monitor.ts carry other sessions' WIP — read freely, edit never.
DATABASE_URL is in the environment.

## Deliverable 1 — automation.failure_count warning (open since 2026-07-06 13:45 UTC) — task #3
The diagnostics threshold "Signal-options worker scan failures" (warning at 1) has been breached for
3 days; current snapshot shows staleScanCount 1, lastScanDurationMs ~120,000, and one scan ran 698s
before the 18:31Z restart killed it.
1. Find where scan failures are counted (rg automation.failure_count / failure_count in
   artifacts/api-server/src) and locate the actual recorded failure(s): recentEvents in the automation
   snapshot, diagnostic events store, or DB tables. Identify WHICH scan failed, WHEN, and the error.
2. Why do scans take ~120s? Trace the scan tick (signal-options-automation worker): what work one scan
   does (candidates, option chains, DB reads), whether 120s is pressure-inflation or intrinsic, and
   whether the 698s scan was hung vs progressing.
3. Verdict: is the warning stale/cosmetic (counter never resets since process start), a real recurring
   failure, or collateral of resource pressure? Recommend the minimal correct remediation.

## Deliverable 2 — 3 failed market_data_ingest_jobs (rust worker) — task #4
The market-data work plan persistently shows owner rust-market-data-worker, kind
market_data_ingest_jobs, status failed, jobCount 3, "worker jobs need retry or operator review".
1. Query the jobs table (find its name/schema via rg in artifacts/ or lib/db): the 3 failed rows —
   kind, symbols, created/failed timestamps, attempt counts, error text.
2. Check rust worker logs if present (rg for the worker's log path; .pyrus-runtime?), and the
   requeue/retry policy in code (who is allowed to retry: worker, API, operator?).
3. Verdict per job: transient (safe to retry) vs deterministic failure (needs code/data fix). Give the
   exact retry command/SQL an operator would run, but DO NOT run it.

## Deliverable 3 — scanner coverageHealth "lagging" verdict — task #5
The options-flow scanner plans 755 symbols, batchSize 4, intervalMs 15000, effectiveConcurrency 1-2,
estimatedCycleMs 2,835,000 (~47 min), coverageHealth "lagging".
1. From source (flow-universe-planner.ts / options-flow-scanner*), determine how effectiveConcurrency,
   batchSize, maxDeepScanLines are derived — which are pressure-gated vs configured.
2. Compute the expected cycle time at NORMAL pressure with the configured values. Is "lagging" purely
   a pressure artifact that resolves when the ELU/pool fixes land, or under-provisioned by design
   (755 symbols can never complete in a useful window even when healthy)?
3. Verdict + recommendation (config change, horizon reduction, or "no action — re-evaluate after
   pressure fixes land"). No speculative tuning.

## Report format
Per deliverable: observed facts (with sources/commands), inference vs unknown labeled, verdict,
recommendation. End with a 10-line executive summary.
