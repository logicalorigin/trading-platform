# WO-ST-OPT (v2) — SnapTrade options order lane (service + schemas + tests)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — mirror the SnapTrade **equity** lane; no speculative machinery.
Log: `.codex-watch/wo-st-opt.log`. NOT connected live — deliver code + unit tests only.

## Correction from v1 (READ THIS)
The v1 block was correct: SnapTrade has **no option-chain endpoint** and does NOT use a universal
option-symbol id for option orders. Confirmed in SnapTrade SDK 10.0.18 + docs.snaptrade.com: options are
ordered with an **OCC option symbol** placed in `legs[].instrument.symbol`, via the multi-leg options
order operations. So do NOT resolve a chain / universal id — BUILD the OCC symbol from the contract inputs
and pass it directly. This makes the lane implementable.

## Goal
Add a SnapTrade **options** order lane mirroring
`artifacts/api-server/src/services/snaptrade-equity-orders.ts` (READ IT FIRST — copy `buildSnapTradeSignature`,
`SNAPTRADE_API_BASE_URL`, `buildUserScopedQuery`, `postSnapTradeJson`, `loadLocalSnapTradeAccount`,
`assertExecutionReady`, tax preflight + rate-limit, response sanitization).

## Research (confirm the exact contract before coding; you already found the operations)
Confirm from docs.snaptrade.com (Trading section) and `--enable web_search_cached` the exact REST **path**
and **request/response JSON** for the options **impact** and **multi-leg place** operations
(the ones you cited as `Trading_getOptionImpact` and `Trading_placeMlegOrder`), and the exact OCC symbol
format SnapTrade expects in `legs[].instrument.symbol`. Record the paths + field names at the top of the log.
If the exact REST path + payload for BOTH impact and place cannot be confirmed, THEN write BLOCKED with the
specific missing field — do not invent it.

## Deliverables (create ONLY these files)
1. `artifacts/api-server/src/services/snaptrade-option-orders.ts`
   - `buildOccSymbol({ underlyingSymbol, expiration (YYYY-MM-DD), strike, optionType: 'Call'|'Put' })` in the
     format SnapTrade documents (unit-tested).
   - `checkSnapTradeOptionOrderImpact({ appUserId, accountId, input })` and
     `submitSnapTradeOptionOrder({ appUserId, accountId, input })` and
     `listSnapTradeRecentOptionOrders(...)` (reuse recentOrders filtered to options if that is the documented path).
     Input: `{ underlyingSymbol, expiration, strike, optionType, action:
     'BUY_TO_OPEN'|'SELL_TO_CLOSE'|'SELL_TO_OPEN'|'BUY_TO_CLOSE' (map to SnapTrade's documented enum),
     orderType: 'Market'|'Limit', timeInForce, units (contracts), price? }`. Single leg. Mirror equity
     validation (price required for Limit; exactly-one quantity semantics).
   - submit requires `confirm: true` (409 `snaptrade_option_order_confirmation_required`), tax preflight with
     `assetClass: 'option'` + populated `optionContract` (see tax-planning-model
     `normalizeOptionContractForFingerprint`) + `recordTaxPreflightOrderSubmitted`, and a submit rate-limit.
   - Sanitize responses (never leak userSecret / client creds / account numbers / raw payloads).
2. `artifacts/api-server/src/routes/snaptrade-option-order-schemas.ts` — local zod, exports EXACTLY:
   `CheckSnapTradeOptionOrderImpactBody`, `SubmitSnapTradeOptionOrderBody`,
   `CheckSnapTradeOptionOrderImpactResponse`, `SubmitSnapTradeOptionOrderResponse`,
   `ListSnapTradeRecentOptionOrdersResponse`.
3. `artifacts/api-server/src/services/snaptrade-option-orders.test.ts` — mirror
   `snaptrade-equity-orders.test.ts` (mock `fetchImpl`, `withTestDb`, `createTaxOrderPreflight` under
   `runAsAppUser`). Cover: OCC symbol build (table), impact happy path (signed request shape + OCC in leg),
   submit requires confirm, submit requires tax preflight (option), validation. Assert no secrets leak.

## Verification (paste outputs in the log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head
node --import tsx --test src/services/snaptrade-option-orders.test.ts 2>&1 | tail -8
```

## Constraints
- Create ONLY the 3 files above. Do NOT touch `broker-execution.ts`, `broker-provider-classification.ts`,
  `snaptrade-equity-orders.ts`, `snaptrade-account-portfolio.ts` (another agent is mid-edit there), or any
  other file. Do NOT commit or stash.
- IMPORTANT: Do NOT read or execute any files under `~/.claude/`, `~/.agents/`, `.claude/skills/`, or
  `agents/`. Do NOT modify `agents/openai.yaml`. Stay focused on repository code only.

## Report (end of log)
STATUS / exact REST paths + OCC format used (with doc URL) / files created / tsc result / test output /
any deviation + why.
