# LIVE Recovery Note — leader-claude (supervisor / orchestrator)

- Session ID: `45931117-3304-4b9c-8f4c-cdb8a8d46345` (Claude Code, LEADER). PID 1100, pts/7.
- Role: **LEADER / orchestrator.** Coordinate via the chat bus only; leader is the only one who stages/commits.
- Chat bus: `http://127.0.0.1:8765` (server pid 4978, restarted 2026-06-18 ~19:49 MDT). Files: `AGENT_CHAT_MESSAGES.jsonl`, `AGENT_CHAT.md`, `AGENT_TASK_BOARD.md`.
- Workers this round: **agent1-claude** (frontend) · **agent1-codex** (backend).
- ⚠️ Do NOT trust `SESSION_HANDOFF_CURRENT.md` / `SESSION_HANDOFF_MASTER.md` pointers — the autosave hook repoints them to blank reconnect sessions. **This file + the chat are the source of truth** for leader state.

## Worker Ledger

| Worker | Lane(s) | Assigned seq | State | Last seen | Leader next action |
|---|---|---|---|---|---|
| agent1-codex | Backend A/B DONE + ACCEPTED (pending source review): bridge honest-503 runtime-unattached + fake-pressure `resourceLevel` (preserves real dbPool). NOW: typed detached-read contract (read-only /accounts/* → last-known+asOf+stale, orders blocked); THEN cross-review fan-out | …/145/148 | working | seq 145 | verify typed-stale-payload + cross-review |
| agent1-claude | **FAN-OUT (USER #1) IN PROGRESS** — approved fan-out T1+T2+sparkline-seed-prio; T3 signal-trio HOLD; T2 precond = 11-screen primaryReady verify. ACCEPTED: A2, B1a, B1c. GATED: B1d (keep reads gated). QUEUED: STA column auto-width → B2 → B1b | …/144/147 | working | seq 144 | land fan-out + live-verify sparkline payoff |

States: assigned → acknowledged → working → reported → accepted / superseded / parked.

## Acceptance gate (applies to both)

- **Self-review verdict present** — worker spun a fresh-context review that tried to REFUTE its own change and it survived.
- Source review of changed **and untracked companion** files.
- Focused tests added/updated and passing; typecheck where scope warrants.
- Runtime evidence: live browser/QA for UI/data-flow (frontend); live diagnostics route for backend pressure/bridge.
- `git diff --stat` reviewed; staging excludes `.replit`, chat logs, handoffs, and unrelated WIP.

## Commit policy

- Workers never stage/commit. Leader stages accepted hunks (hunk-level when accepted + WIP share a file) after a verified report, then `git diff --cached` before commit.

## Open coordination notes

- agent1-codex owns backend bridge-honesty + fake-pressure ROOT; agent1-claude owns the frontend read/gate side of the same slow-load symptom — keep their boundary clean (backend = config/pressure emit; frontend = render gates / data-wait).
- STA Move hardening already committed (delta 34/34) — not in scope.
- Autosave hook CANNOT be disabled per-worker (agent1-claude seq 127): no agent `/hooks` access; the hook keys on payload session_id with no env opt-out; `settings.local.json` env is checkout-wide so disabling there would kill the leader's autosave too. Workers will strictly not hand-write the handoff/pointer files — **this leader LIVE note is the durable source of truth.**
- STA-table sparkline disappearance is a shared signal: agent1-codex confirms whether fake-pressure shed starves the data path (backend); agent1-claude traces render/routing (frontend). A correct backend fix should make sparklines return.
- **KEY FINDING (agent1-claude seq 131):** warm reload fires a large boot request fan-out (bars+quotes+flow ×2/underlying, gex projection+zero-gamma/sym, signal-monitor, algo cockpit, positions/orders) + background-preloads algo chunks while on Market → REAL connection-pool saturation (latencies 200ms→3834ms; /api/gex/SPY/projection 3834ms). "15m spot bars not hydrated yet" = bars stuck PENDING behind that queue → **likely THE STA-sparkline-non-display root** AND the slow-load root (one root, two symptoms). Source: `isVisible`=active-tab (misnomer, not viewport); platform queries gate on `screenWarmupPhase===ready && !startupProtectionActive` (PlatformApp.jsx:2761/3667), warmup→ready needs active-screen chunk frameReady (1248-1250), startupProtection releases 250ms after firstScreenReady (1017-1026). Bridge read LIVE in his session → frontend bridge-DETACHED wait did NOT reproduce (that's agent1-codex's backend false-down).
- **REAL-vs-FAKE pressure conflict to resolve before either implements:** agent1-claude sees REAL pool saturation from the fan-out; agent1-codex is chasing FAKE pressure. They must NOT make opposing changes — codex only fixes fabricated/mis-thresholded pressure, not a signal honestly reporting real boot saturation.
- **APPROVAL GATE:** "no band-aids" = structural boot-sequencing refactor. Both workers must post per-lane fix DESIGN (scope/files/risk) for leader approval BEFORE editing.
- **DESIGN REVIEW (seq 134 → 135/136):** APPROVED — frontend pressure read-hysteresis (`useMemoryPressureSignal.js`, sustained-only + fail-open); bridge-detached (a) un-gate `/accounts/flex/health` query, (b) degraded reconnect banner, (c) relabel PositionsPanel "broker-not-connected". HELD — (1d) render last-known REST snapshot, pending codex's detached-read contract. **PRODUCT DEFAULT (leader call):** show last-known account data when configured-but-detached ONLY as explicitly stale (degraded banner + "as of <ts>"), never as live, never backing order entry; if backend can only hard-error, keep gated + banner/health. Codex to make detached reads return a typed `last-known + asOf + stale-flag` payload instead of erroring. → flagged to user for override.
- **LANE A resolved (seq 137 → 138, user A1 call):** **A2 APPROVED + implementing** — root is a DUPLICATE ungated eager preload at `AppContent.tsx:196` (rIC 2s timeout force-fires mid-boot, floods pool/main-thread); fix removes it + folds `trade` into PlatformApp's gated `PRIORITY_SCREEN_MODULE_PRELOAD_ORDER` (runs after first paint), preserving 3c43ff0 coverage. **This is the STA-sparkline + slow-load root fix.** **A1 (boot-overlay blocking set): USER CHOSE KEEP documented `bootPolicy.js` behavior — do NOT change; rely on A2.** Required before accept: orphan-helper check; `node --test` regression (ungated preload gone + gated order has all 4 screens); live re-verify (boot latency flattens + STA sparklines hydrate); adversarial self-review. Then STA column auto-width (T2).
- A1-resolution posted (seq 146). Consolidated decisions posted seq 147 (claude) / 148 (codex).

## ⏸ COMMIT IN PROGRESS — checkpoint posted seq 149, NOT yet executed
- User directed: commit the done pieces, then all agents save handoffs.
- BLOCKED on: (1) transient Bash/git classifier outage (git + chat posts unavailable); (2) workers have NOT yet ACKed PAUSED to seq 149 (both mid-edit: claude on fan-out → PlatformApp.jsx/AccountScreen.jsx; codex on typed-stale-payload → routes/platform.ts + account-route-admission.ts).
- Tree is 252 dirty files → stage ONLY the manifest below; verify `git diff --cached --stat` matches workers' reported line counts before each commit.
- Planned commits (on `main`, no push): (1) backend bridge/pressure (17 files, whole-file); (2) A2 boot-preload [AppContent.tsx whole + PlatformApp.jsx **line-333 hunk only** + AppContent.preloadContention.test.mjs]; (3) bridge-detached UI [AccountScreen.jsx **@1640/@1661 hunks only** + PositionsPanel.jsx whole + 2 tests].
- RESUME: once classifier recovers + PAUSED acks land → hunk-stage, verify, commit ×3, then post handoff instruction to all agents + save leader handoff.

## Accepted, pending leader source review (commit-queued when round is green)

- **agent1-codex backend** (17 files, +1387/-79): runtime-unattached vs not-configured honest 503; connectivity-honesty (decoupled from stale clocks); `resourceLevel` fake-pressure exclusion that PRESERVES real dbPool saturation. Tests 35/35 + 54/54 + typecheck + adversarial 63/63.
- **agent1-claude A2:** `AppContent.tsx` (remove ungated eager preload + orphans) + `PlatformApp.jsx:333` (+`trade` in gated order) + `AppContent.preloadContention.test.mjs`. typecheck + 4/4 + 8/8 + live.
- **agent1-claude B1(a):** `AccountScreen.jsx` un-gate flex-health (2 hunks mine; **@2529 accentColor is PRE-EXISTING — stage separately**) + test 2/2.
- **agent1-claude B1(c):** `PositionsPanel.jsx` detached relabel + test 1/1.

### ⚠️ Hunk-staging discipline (pre-existing WIP to EXCLUDE)
Working tree carries unreviewed WIP NOT from this round — stage only this round's accepted hunks: `PlatformApp.jsx` pressure changes (467-503/1470/1483), `AccountScreen.jsx:2529` accentColor, `useMemoryPressureSignal.js` +167, `custom-fetch.ts` +97. Also never stage `.replit`, chat logs, handoffs.

### Decisions log (seq 147/148)
- FAN-OUT: approved T1 + T2 + active-sparkline-seed prioritization; HOLD T3 signal-monitor-trio (stale-strip risk) unless sparklines still fail after T1+T2. T2 precondition: 11-screen primaryReady verify.
- A2: keep `trade` in gated set. B1(d): keep reads gated (real /accounts/* hard-503 today). B1(b): build after fan-out, verify via forced-detached test + design-review, mark unverified-live.
- DEFERRED: typed detached stale-payload (codex, seq 148) → then wire B1(d); `isVisible`=active-tab rename (cosmetic, 11 screens).
