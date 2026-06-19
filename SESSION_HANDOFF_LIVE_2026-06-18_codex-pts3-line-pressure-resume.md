# LIVE Recovery Note — codex-pts3 (Codex worker resume)

- Session ID: `pending` (Codex runtime store was wiped — `~/.codex/sessions/` empty, `state_5.sqlite` has no thread rows; resume by **workstream identity**, not session id)
- Created (MT): `2026-06-18 17:07 MDT`
- Worker terminal: Codex (separate terminal session). Adopt chat handle **`codex-pts3`**.
- Leader / coordinator: **`leader-claude`** (this Claude Code session). Coordinate only via the chat endpoint.
- Chat endpoint: `http://127.0.0.1:8765` — `GET /messages`, `POST /messages {from,text}`, `GET /stream`.

## Authority (this round)
- ✅ Implement fixes. ✅ Spin up your own sub-agents / independent reviews.
- ❌ Do NOT `git add` / stage / commit. **leader-claude stages & commits** after your verified report.
- ❌ No app restart, no broker connect/disconnect, no POST/PUT/DELETE against the running app.

## Workstream
IBKR market-data **line pressure / backoff + lease shedding/release**; broker-flap root cause; connection popover `Stream 1 / 501`; bridge health-proof HTTP 502.

## In-flight leader fixes ALREADY in the working tree — VERIFY + HARDEN (do not re-author)
Observed via `git status` + `rg` on 2026-06-18 17:07 MDT:

1. **`artifacts/api-server/src/services/market-data-admission.ts`** (`M`) — scanner-shed **damping window** present (`IBKR_PRESSURE_SCANNER_DAMPING_WINDOW_MS`, `policy: "scanner-shed-damping"`, lines ~290/556/561/572/2063). Fixes the audited oscillation: one-shot shed of half the flow-scanner leases without lowering the effective cap let the scanner refill to the ceiling and retrip. Damping clamps flow-scanner effective cap to the post-shed target for ~60s while leaving core leases intact.
2. **`artifacts/api-server/src/services/bridge-quote-stream.ts`** + **`bridge-option-quote-stream.ts`** (both `M`) — generic `output exceeded` **removed** from the destructive capacity classifiers (string no longer present, confirmed by rg). Explicit line/ticker/subscription/lane-queue/pacing pressure still routes to `recordMarketDataAdmissionIbkrPressure`. Tests updated so `Output exceeded limit (was: 100031)` does NOT create ibkrPressure or shed scanner demand; quote-stream source guard asserts the classifier no longer contains the generic text.

## Definition of done
- Confirm both fixes present & coherent in the working tree (`git diff` the three files).
- Run focused tests + typecheck:
  - `pnpm --filter @workspace/api-server exec tsx --test src/services/bridge-option-quote-stream.test.ts src/services/bridge-quote-stream.test.ts src/services/market-data-admission.test.ts`
  - `pnpm --filter @workspace/api-server run typecheck`
- Get an independent review (sub-agent) of the damping-window direction + classifier scoping.
- Post PASS/FAIL + `git diff --stat` summary to `leader-claude` in chat for commit.

## Already-traced context (source-confirmed by prior codex-pts3)
- Connection popover render path: `HeaderStatusCluster` → `useIbkrLatencyStats(bridgePopoverOpen)` from `artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream`.
- Pressure separation: `resource-pressure.ts` `buildSnapshot` keeps request/client/cache pressure in `snapshot.level`; `resourceLevel` is server-saturation only (rss/heap/event-loop/db pool); `route-admission.ts` admission uses `pressure.resourceLevel`.

## Key files
`artifacts/api-server/src/services/{market-data-admission.ts, bridge-quote-stream.ts, bridge-option-quote-stream.ts, resource-pressure.ts, route-admission.ts}`

## Carryover source
Full prior transcript archived at `AGENT_CHAT_MESSAGES_archive_2026-06-17_to_18.jsonl` (seq380–404 cover this workstream).
