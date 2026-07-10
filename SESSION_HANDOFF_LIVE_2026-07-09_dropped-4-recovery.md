# DROPPED-SESSION RECOVERY — the 4 sessions lost at the 2026-07-09 ~12:15–12:18 MDT reconnect

- Written: 2026-07-09 ~12:25 MDT by session `ba0aa3a2-9441-422b-b8fc-7d4020eaed38` (Claude, opus-4-8)
- Cause of drop: whole-microVM rotation. `pid2` respawned at 12:15:25; API/web/MCP came back 12:17–12:18.
  The rotation wiped `~/.claude/projects/**` and the entire `~/.codex` home.
- **Resumability**: these 4 are recoverable as **context**, not as live threads. The 3 Claude transcript
  `.jsonl` files were wiped (only THIS session survives on disk), so `claude --resume <id>` will NOT work.
  The Codex home was re-initialized (`state_5.sqlite` migrations stamped 18:18:11Z), so the pre-reconnect
  Codex thread/rollout is gone too. Pick up via the handoff + LIVE notes + `.codex-watch/` reports below.
- Shared git state at drop: **9 commits ahead of origin/main, unpushed**; HEAD `7c2dd350` (WO-SEC-1).
  Working tree: 53 modified + 36 untracked + 2 staged (~1,507 insertions). Uncommitted hot files:
  `shadow-account.ts`, `signal-monitor.ts`, `signal-monitor-local-bar-cache.ts` — DO NOT blow these away.

---

## 1. Claude `addde099-628b-4ac6-bc1b-04197cb22d86` — DB-pressure / signal-monitor GC root-cause + codex FLEET LEADER
- Model opus-4-8 · CWD `/home/runner/workspace` · first ask "find the most recent claude and codex sessions" → became the perf root-cause program (resume of `f834d411`).
- **Most recent work (~12:16):** THE deliverable = the "5m signal fix". Root cause = retention sweeper's
  6h cadence never survived today's ~12 restarts → 2.6M stale `bar_cache` rows never drained → 8.3GB table
  → slow 5m/15m reads → 15m signal cells starving. Manual batched psql drain RAN to completion
  (`[18:17:24Z] END bar_cache batched drain`); RET-1 scheduler hardening landed (`11811b78`) to stop recurrence.
  Full causal chain in `docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md`.
- **Open when it dropped:** VACUUM(ANALYZE) acceptance number (`.codex-watch/run-vacuum.log`); "240-vs-1000
  bars" output-diff investigation (WO-SIGDIFF, read-only, approved); demand-reducing fixes F1–F4 awaiting
  Riley sign-off. Riley decisions pending: (1) execution_events VACUUM FULL window; (2) push the 9 commits;
  (3) incremental-eval shadow→on flip after soak.
- **Read to resume:** `SESSION_HANDOFF_2026-07-09_addde099-628b-4ac6-bc1b-04197cb22d86.md` +
  `SESSION_HANDOFF_LIVE_2026-07-09_wo-fb-s3b-reprofile-gate.md` +
  `SESSION_HANDOFF_LIVE_2026-07-09_pressure-bar-cache-runtime.md`. Fleet ticker: `.codex-watch/fb2-chain-status.log`.

## 2. Claude `71069931-766d-4d26-946d-c9027fc57ad5` — positions-table math / day-change + Robinhood order lane
- Model **fable-5** · CWD `/home/runner/workspace/artifacts/api-server` · ask "trace of massive api data …
  strange math in the positions table".
- **Most recent work (~12:13):** positions day-change fixed and confirmed by Riley ("rh looks god").
  WO-POS-1..4 all landed (`cebd8e72`, `6219f683`, `e93f50b2`, `5cc15885`). Then building the **Robinhood
  equity order lane** (WO-RH-ORDERS) via a codex worker — was ACTIVELY WRITING at drop
  (`.codex-watch/wo-rh-orders.log`, last edit `robinhood-account-sync.ts`/`broker-provider-classification.ts`).
  Context: E*TRADE $5 test buy already EXECUTED (PLUG x1 @ 2.3999, Roth IRA, order 3346) via SnapTrade lane.
- **Carries the coordination note** `SESSION_HANDOFF_LIVE_2026-07-09_positions-daychange-bidask.md` — has an
  UNCOMMITTED `getShadowAccountPositions` `underlyingMarket` merge hunk (~shadow-account.ts:9777) that must be
  folded into the next shadow-account.ts commit; bid/ask lag is a symptom of session 1's DB-pool/ELU pressure.
- **Read to resume:** `SESSION_HANDOFF_2026-07-09_71069931-766d-4d26-946d-c9027fc57ad5.md` + that LIVE note +
  `docs/plans/workorders-2026-07-09/WO-RH-ORDERS-robinhood-equity-lane.md`.

## 3. Claude `9627dd6f-3d1b-4c17-87d0-89ae768a6ce7` — whole-app QA campaign leader (fable)
- Model opus-4-8 (Riley: "stay in fable") · CWD `/home/runner/workspace` · plan+run a whole-app QA campaign,
  distributing to the codex agent fleet.
- **Most recent work (~12:06):** 12-screen headless QA ran authenticated; market screen renders correctly.
  Wired env-gated `storageState` into `artifacts/pyrus/playwright.config.ts` (non-breaking) so algo/chart
  specs run authenticated. Built the combined "finish" runner (`.codex-watch/qa-campaign-2026-07-09/finish.sh`)
  that dispatches WO #44 when the sibling releases `platform.ts` and runs the algo/chart specs.
  Last state: `finish-results.txt` shows algo-panel-save + chart-hydration specs launched (2 skipped) at load 15.9.
- **Read to resume:** `SESSION_HANDOFF_2026-07-09_9627dd6f-3d1b-4c17-87d0-89ae768a6ce7.md` + the QA campaign dir
  `.codex-watch/qa-campaign-2026-07-09/` (`COORDINATION-claude-addde099.md`, `fe-qa-results.txt`, `finish-results.txt`).

## 4. The Codex session — NOT resumable by ID (home wiped); work product survives in `.codex-watch/`
- The pre-reconnect Codex CLI thread that dispatched/ran the fleet workers was destroyed by the microVM
  rotation: `~/.codex/sessions/` only holds `12:19:40`+ rollouts and `state_5.sqlite` was re-created at
  reconnect. There is **no pre-reconnect codex thread row, rollout, or history** to resume.
- The only Codex thread in the store now is a **fresh, live, unrelated** post-reconnect session:
  `019f481b-5d40-7130-9353-9a40b4a669fc` ("Locke", gpt-5.6-sol, title "hi sol … install the ponytail skill?",
  live as PID 1175/1182) + 4 subagents. That is NOT one of the dropped four — leave it running.
- **What the dropped codex fleet was doing is fully durable** in the repo (survived the rotation):
  - `.codex-watch/fb2-chain-status.log` — full dispatch timeline; last events `[18:15:39Z] END wo-sec-1`,
    `[18:17:24Z] END bar_cache batched drain`.
  - Per-WO reports: `.codex-watch/wo-sec-1-report.md` (→ HEAD `7c2dd350`), `wo-ret-1-report.md`,
    `wo-open-accept-report.md`, `wo-p2-explimits-report.md`, `wo-fb2-review*-report.md`, `wo-pos-*.log`,
    `plan-robinhood-trade-path.log`, `plan-snaptrade-order-path.log`, `run-wo-rh-orders`→`wo-rh-orders.log`.
  - Work orders: `docs/plans/workorders-2026-07-09/`.

---

## First moves for the next agent
1. Read this file, then the 3 per-session handoffs + 3 LIVE notes named above (they hold file:line detail).
2. Do NOT discard working-tree WIP: `shadow-account.ts` / `signal-monitor.ts` / `signal-monitor-local-bar-cache.ts`
   have uncommitted hunks owned by sessions 1 & 2; the positions LIVE note explains the merge coordination.
3. Decisions that were waiting on Riley: push the 9 unpushed commits? execution_events VACUUM FULL window?
   incremental-eval shadow→on flip? (all in session 1's LIVE note).
4. The live codex `019f481b` (ponytail install) is separate — don't kill it, don't confuse it with the dropped work.
