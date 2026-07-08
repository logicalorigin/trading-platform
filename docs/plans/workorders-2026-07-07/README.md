# Codex work orders — 2026-07-07 hanging-workstreams completion

Companion to `docs/plans/2026-07-07-hanging-workstreams-completion-plan.md`. One file per work order; each is a self-contained prompt for a codex subagent.

## Dispatch conventions (apply to every WO)

```bash
# from repo root; STAGGER launches >=20s apart (thread-exhaustion risk, see memory note)
codex exec -s danger-full-access -c 'model_reasoning_effort="medium"' - \
  < docs/plans/workorders-2026-07-07/wo-NN-*.md \
  > .codex-watch/wo-NN-run.log 2> .codex-watch/wo-NN-err.log
# Bash tool: run_in_background: true (tsc alone ~300s)
```

- bwrap sandbox is broken in this container → unsandboxed exec is owner-approved; discipline lives in the WO text.
- Every WO ends with a scope-check (`git status` diff must cover only its SCOPE files), a lane-scoped test/tsc gate, and a written report under `.codex-watch/`.
- Health check for a wedged worker: no open `~/.codex/sessions/**/rollout-*.jsonl` fd + ~0% CPU after 2 min → kill and relaunch.

## Dispatch board

| WO | Title | Status (2026-07-07 ~14:30 MDT) | Outcome / gate |
|---|---|---|---|
| 01 | Orphan uncommitted-diff disposition | DONE | commits `519b8893`, `7519f869`; all 6 files attributed |
| 02 | Lane-ownership matrix (tally + pressure) | DONE | verdict: WO-03/05 stay parked; persist-path fix already in pressure lane's uncommitted `signal-monitor.ts` residue |
| 03 | Bar-cache persist prefetch scope fix | PARKED | target region overlaps live-lane residue (477 lines) that already contains a batch-lookup fix; re-check after that lands |
| 04 | Startup/runtime leftovers | DONE | pg sslmode fix committed `680f9491`; ECONNREFUSED = startup-ordering noise (patch sketch in report); shadow-orders = pool queueing, not missing index |
| 05 | Throttle RETUNE batch | PARKED | gates unmet: tally still `shadow`, bake unverified, no user OK |
| 06 | Expected-move-v2 recalibration | DONE (report 14:44) | directionalFeatures confirmed LIVE (no compute reload needed); dumps regenerated (5m/15m/1h); recommendation: **keep expected-move-v2, no flip** — 90+ band precise but low-recall; cleaner full-universe dump run advised first. Decision pending user. |
| 07 | Round-5 audit triage | DONE | 19/22 still open; batches A–D proposed as WO-51..54; protan = inert (wire-or-delete decision) |
| 08 | Schwab order routes wiring | DONE | commit `8407812d`; preview/submit/cancel live behind entitlement+readiness; 73 tests pass |
| 09 | Schwab readiness re-auth blocker | DONE | commit `fc0a328a`; invalid_grant → reauth_required + Reconnect CTA; codegen updated |
| 10 | SnapTrade mocked-state browser QA | BLOCKED | login gate (Slice 8) blocks unauthenticated helper shots; needs a storage-state file or authenticated e2e run (`snaptrade-surfaces.browser-validation.spec.ts` covers the paths) |
| 11 | Multi-user Slice 9 `audit_events` | DONE | commit `7a6d612c`; migration verified APPLIED (2026-07-07 18:55 MT: 32 rows — 27 broker.connect_start, 3 auth.login, connect_complete, sync) |
| 12 | Multi-user deferred-domains triage | DONE | **Slice-10 risk: `algo_deployments` reads are not user-scoped (cross-user read exposure)**; saved_scans/alert_rules have no route surface; feature_flags doesn't exist; gateway reaping uncovered |
| 13 | IBKR portal mount-base fix | DONE | commit `0a20c0c5`; gateway-referer'd `/api/<X>` 307→`/sso/<X>`; 49/49 route tests; manual 2FA retry procedure in report — retry now unblocked |
| 14 | Missed-trades post-mortem | DONE | report in `.codex-watch/`; 2,729/2,783 signals never evaluated; hard-block gate + restart churn + MTF 3-of-3 |
| 15 | Multi-user scope: algo_deployments | DONE (report) | **finding: `listAccounts` persisted/SnapTrade queries + backtests services LEAK across users (no app_user_id predicates)** — documented, NOT fixed (out of scope + dirty adjacent lanes); needs a follow-on slice |
| 16 | Broker-connect desktop handoff | DONE | commit `b933e8e2`; copy-link + QR fallback when popup blocked |
| 18 | Robinhood accounts in list | DONE | landed via `785beb45`/`b978f62d`; provider:"robinhood" snapshots with capabilities/executionReady |
| 19 | Robinhood detail/balance fallback | DONE | commit `d580b00c`; per-user MCP session hydration; 16 tests pass |
| 51 | Round-5 Batch A (mechanical swaps) | DONE | committed (UNKNOWN_STATUS_GLYPH in `MachineStateDiagram.jsx` at HEAD); pyrus typecheck green |
| 52 | Round-5 Batch B (primitive loading) | DONE | commit `32c472f2`; FamilyChip→canonical Badge; typecheck green |
| 53 | Round-5 Batch C | NOT DISPATCHED | order file exists; no report/logs |

> **Post-VM-rotation status refresh 2026-07-07 ~18:50 MDT** (session `03f2c018` resuming `f68a9158`): rows 06/13 were stale "RUNNING" — both lanes completed and reported before the ~18:17 VM rotation killed the sessions. Rows 15–53 added from their `.codex-watch/` reports.

## Code-reduction lane (wo-cr chain, added 2026-07-07 ~21:30 MDT by claude-lead session b2a7b7f4)

Zero-function-loss code reduction. Lead landed Wave 1 + Wave 2 slices 1–2 directly
(`8cef8121`, `1677acaf`, `12aa4346`, `b68abe94`, `f831ed76`, `67ddfd2f` — ~3.4k lines removed);
the remainder runs via this STRICTLY SEQUENTIAL chain (shared files across orders — one worker
at a time, dispatch the next only when the predecessor's `.codex-watch/wo-cr-NN-report.md`
lands with a green gate). Baselines for diffing: `.codex-watch/code-reduction-baselines/`.

| WO | Title | Status | Outcome / gate |
|---|---|---|---|
| CR-01 | api-server helper consolidation (snaptrade-shared, values.ts, asRecord split) | DISPATCHED 2026-07-07 | report: `.codex-watch/wo-cr-01-report.md` |
| CR-02 | pyrus formatter consolidation + Button collapse + OCC parser | NOT DISPATCHED (gate: CR-01 report green) | parity-matrix protocol binds |
| CR-03 | final gate (typecheck/builds/knip diff/guard tests/SIGUSR2+healthz) + deferred note | NOT DISPATCHED (gate: CR-02 report green) | writes `docs/plans/2026-07-08-code-reduction-deferred.md` |

Known pre-existing failures (NOT this lane's; ledger inside the WOs): api-server
`bridge-streams.test.ts` snapshot-bootstrap contract test (massive-repoint drift); pyrus
`loadingFallbackTheme.test.mjs` /brand/ favicon assertion.
