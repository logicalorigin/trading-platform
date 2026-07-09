# WO-POS-STREAM-PARITY — positions live-quote streaming + wrong-positions bugs + accounts/algo table parity

Dispatched by Claude session 26888663 (2026-07-09 ~13:15 MDT) at Riley's request. Worker: codex sol.
Report to: `.codex-watch/wo-positions-stream-parity-report.md`. Leave ALL edits UNCOMMITTED; the
dispatcher reviews and lands (hunk-level staging around foreign WIP is required in this tree).

## Discipline
- /ponytail full: laziest fix that actually works, minimal diff, no speculative abstractions.
- Fact-first: every bug you fix must be stated as file:line + concrete failure scenario BEFORE the fix.
  If a symptom cannot be proven from source/runtime, report it as unverified — do not speculative-fix.
- NO band-aid fixes (Riley directive): no polling-rate cranks, no cache-TTL fiddling to mask defects,
  no route-admission/shedding semantic changes (the pressure lane owns those — see
  `SESSION_HANDOFF_LIVE_2026-07-09_positions-daychange-bidask.md`).
- The tree is DIRTY with other sessions' WIP. Do not revert or reformat anything you didn't write.
  Specifically preserve: shadow-account.ts foreign hunks around lines ~3334 (`readShadowFillsForOrderIds`)
  and ~8541, and the uncommitted `underlyingMarket` merge fix inside `getShadowAccountPositions`
  (~line 9777: `{ ...underlyingMarkets.get(sym), ...optionUnderlyingQuote }`) — build on it, never revert.

## Deliverable 1 — Massive → positions-table live columns (Bid/Ask etc.) actually stream
Symptom: on the account positions table, Spot updates live but Bid/Ask (and other option-quote-derived
columns) lag or sit on the 3s REST poll fallback. Prior analysis (see the handoff above) says the
option-quote path (Massive OPRA → normalize → `/api/ws/options/quotes` push via
`services/bridge-option-quote-stream.ts`) is starved/shed under resource pressure, while Spot rides a
persistent equity websocket (`useRuntimeTickerSnapshots`). Massive options realtime IS configured.
Task:
1. Trace the full path server→client: bridge-option-quote-stream.ts (NOTE: dirty, has WIP), the ws
   route registration, client consumption in artifacts/pyrus (live-streams.ts, PositionsPanel.jsx,
   snapTradeAccountPanelModel.js, AccountScreen.jsx). Establish with evidence where updates stop
   flowing: subscription never established? server pushes but client ignores? freshness gate drops
   ticks? pressure shed only?
2. Fix the genuine defects in that path (e.g., dropped/never-renewed subscriptions, freshness or
   identity gates that discard valid ticks, fallback that never re-upgrades to the stream after
   pressure eases, columns bound to the REST snapshot instead of the stream). It is acceptable and
   expected that bid/ask still degrades under hard pressure — the bug to fix is any place the stream
   fails to deliver EVEN WHEN capacity exists, or fails to recover after pressure eases.
3. State clearly in the report which residual lag is pure pressure-starvation (not yours to fix).

## Deliverable 2 — connected + shadow accounts display the WRONG positions
Riley reports connected (SnapTrade-linked) and shadow accounts showing incorrect positions.
Investigate and fix provable bugs in:
- SnapTrade merge/mapping: `services/account.ts`, `services/snaptrade-account-portfolio.ts` (dirty,
  recently extended), `account-list-snaptrade-merge.test.ts`, cost-basis/avg normalization
  (recent commit 5cc15885 normalized per-contract option averages; check for leftover call sites).
- Shadow ledger positions: `getShadowAccountPositions` / `buildFastShadowPositionsResponse` in
  `services/shadow-account.ts` — wrong rows (positions from another account/ledger), wrong quantities,
  closed positions still shown, option rows keyed/merged onto the wrong contract, mirror-repair
  desync between connected accounts and their shadow mirrors.
Candidate failure classes to check explicitly: account-id scoping misses (cross-account leakage),
stale fast-path cache serving another ledger's rows, fills/orders joined on ambiguous keys, option
contract identity collisions (OCC symbol normalization). Add/extend focused tests for each bug fixed.

## Deliverable 3 — CONFIRM: Accounts screen vs Algo screen positions tables use the same data
Riley suspects a mismatch. Determine definitively (file:line) what each table renders from:
- Accounts screen: artifacts/pyrus/src/screens/AccountScreen.jsx (+ PositionsPanel and its data hooks).
- Algo screen: artifacts/pyrus/src/screens/algo/* (its positions table / deployment positions view).
Answer: same endpoint + same normalization, or different sources? If different and the difference can
produce different numbers for the same account (different endpoints, different quote sources, different
day-change math, different filtering), unify to one shared source/selector with the fix that changes
the least code, and say which one is authoritative and why. If they are intentionally different views
(e.g. algo shows only deployment-owned positions), document that verdict with citations instead of
forcing a merge.

## Verification (required before writing the report)
- `pnpm --filter @workspace/api-server run typecheck` clean.
- Targeted `node --import tsx --test` on every touched service's test file(s); list results.
- If frontend touched: `pnpm --filter @workspace/pyrus run typecheck` clean; run the adjacent
  *.test.mjs where they exist (e.g. AccountScreen.positions.test.mjs).
- Do NOT restart/reload the app — the dispatcher owns runtime verification (SIGUSR2 + headless browser).

## Report format (.codex-watch/wo-positions-stream-parity-report.md)
Per deliverable: bugs found (file:line + failure scenario), fix applied (files + hunks), tests run +
results, unverified suspicions, and the D3 verdict. End with the exact list of files you modified so
the dispatcher can stage your hunks around foreign WIP.
