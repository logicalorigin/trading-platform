# WO-04: Startup/runtime audit leftovers from `019f398e` (INVESTIGATION-FIRST)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. No restarts of the app — observe the LIVE process only; the preview is pid2-anchored and must not be disturbed.

## Context

Session `019f398e` (Jul 6) fixed the neural loader but left three runtime findings unresolved. The throttle audit (`.codex-watch/throttle-audit-2026-07-07.md`) has since mapped the pressure stack — read its "Executive findings" first so you don't re-litigate its KEEP/RETUNE verdicts.

Open items:
1. **Startup-ordering `ECONNREFUSED`** — early Vite proxy errors before the API binds during supervisor startup (`scripts/runDevApp.mjs` orchestrates; API port 8080, web 18747).
2. **Market-data worker `pg` deprecation warning** — locate the exact deprecated usage (likely in `artifacts/*/src/**` worker bootstrap or `lib/db`).
3. **Slow `/api/accounts/shadow/orders`** — profile why; the throttle audit named `/diagnostics/client-metrics` as the dominant slow route, so quantify where shadow/orders actually ranks now.

## Task

1. Evidence pass (read-only): flight recorder (`.pyrus-runtime/flight-recorder/api-current.json`, recent `api-events-*.jsonl`), live log via runtime diagnostics MCP surface if reachable over HTTP (`GET http://127.0.0.1:8080/api/healthz` then diagnostics routes), `rg` for the pg deprecation string in worker code, and `git log` for prior attempts.
2. For each item: root cause with file:line, or "cause unverified" plus the single check that would confirm it.
3. Fix ONLY item 2 (pg deprecation) if it is a mechanical API swap contained in worker/db bootstrap files — small diff, no behavior change. Items 1 and 3: propose the fix (patch sketch), do not apply (startup orchestration and shadow-orders touch other lanes).

## SCOPE (edits, if any)

Only the file(s) containing the deprecated pg usage. Everything else read-only.

## Acceptance / verification

- Report contains root cause or explicit "unverified + next check" for all three items, each with file:line evidence.
- If pg fix applied: worker tests for the touched package pass; typecheck clean in SCOPE; fresh worker logs (from the live flight recorder after the API's own periodic worker restarts — do NOT force one) show no deprecation warning, or state that verification needs the next natural restart.
- Scope-check: `git status` shows at most the pg-fix files.

## Deliverable

`.codex-watch/wo-04-runtime-leftovers-report-2026-07-07.md` with the three findings, evidence, applied/proposed patches, and a ranked recommendation of what to dispatch next.
