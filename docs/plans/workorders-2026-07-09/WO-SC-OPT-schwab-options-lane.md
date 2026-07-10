# WO-SC-OPT — Schwab options order lane (service + schemas + tests)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full) — mirror the Schwab **equity** lane; no speculative machinery.
Log: `.codex-watch/wo-sc-opt.log`.

## Goal
Add a Schwab **options** order lane, mirroring
`artifacts/api-server/src/services/schwab-equity-orders.ts` (READ IT FIRST — copy its OAuth token use
(`schwab-oauth`/`schwab-user-custody`), account load, HttpError codes, preview/submit/cancel shape, tax
preflight + rate-limit, response sanitization). This is NOT connected live — deliver code + unit tests only.

## Research first (fact-first — do NOT guess the API shape)
Determine Schwab Trader API option order payloads from the strongest source, in order:
1. The existing `schwab-equity-orders.ts` (its order JSON shape: `orderType`, `session`, `duration`,
   `orderStrategyType`, `orderLegCollection[{ instruction, quantity, instrument{ symbol, assetType } }]`).
   Options reuse the SAME `/accounts/{encryptedAccountId}/orders` endpoint with `instrument.assetType='OPTION'`
   and an OCC option symbol; `instruction` becomes BUY_TO_OPEN / SELL_TO_CLOSE / SELL_TO_OPEN / BUY_TO_CLOSE.
2. `--enable web_search_cached` against official Schwab Trader API docs to VERIFY the OCC symbol format
   Schwab expects (e.g. `AAPL  240119C00150000` — 6-char padded root + YYMMDD + C/P + 8-digit strike*1000),
   the option `instruction` enum, and preview/`previewOrder` behavior. Record what you used at the top of the log.

## Deliverables (create ONLY these files)
1. `artifacts/api-server/src/services/schwab-option-orders.ts`
   - OCC symbol builder from `{ underlyingSymbol, expiration (YYYY-MM-DD), strike, optionType: 'Call'|'Put' }`
     with correct padding (unit-tested). Validate underlying, expiration, strike.
   - `previewSchwabOptionOrder({ appUserId, accountId, input })`,
     `submitSchwabOptionOrder({ appUserId, accountId, input })`,
     `cancelSchwabOptionOrder({ appUserId, accountId, orderId })`.
     Input: `{ underlyingSymbol, expiration, strike, optionType, instruction:
     'BuyToOpen'|'SellToClose'|'SellToOpen'|'BuyToClose', orderType: 'Market'|'Limit', duration, session,
     quantity (contracts), limitPrice? }`. Mirror equity validation (price required for Limit, etc.).
   - submit requires `confirm: true` (409 `schwab_option_order_confirmation_required`), tax preflight with
     `assetClass: 'option'` + populated `optionContract` (see tax-planning-model
     `normalizeOptionContractForFingerprint`) + `recordTaxPreflightOrderSubmitted`, and a submit rate-limit.
   - Sanitize responses (no tokens / account numbers / raw upstream payloads).
2. `artifacts/api-server/src/routes/schwab-option-order-schemas.ts` — local zod, exports EXACTLY:
   `PreviewSchwabOptionOrderBody`, `SubmitSchwabOptionOrderBody`, `CancelSchwabOptionOrderBody`,
   `PreviewSchwabOptionOrderResponse`, `SubmitSchwabOptionOrderResponse`, `CancelSchwabOptionOrderResponse`.
3. `artifacts/api-server/src/services/schwab-option-orders.test.ts` — mirror
   `schwab-equity-orders.test.ts` (mock `fetchImpl`, `withTestDb`, tax preflight under `runAsAppUser`).
   Cover: OCC symbol construction (table of cases), preview happy path, submit requires confirm, submit requires
   tax preflight (option), cancel, validation. Assert no secrets leak.

## Verification (paste outputs in the log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | head
node --import tsx --test src/services/schwab-option-orders.test.ts 2>&1 | tail -8
```

## Constraints
- Create ONLY the 3 files above. Do NOT touch `broker-execution.ts`, `broker-provider-classification.ts`,
  `schwab-equity-orders.ts`, `schwab-account-sync.ts`, or any file another lane owns.
- Do NOT commit or stash. The dispatcher wires routes + lands.
- If the Schwab option order shape cannot be confirmed, STOP and write "BLOCKED: <what's missing>" at the top
  of the log rather than inventing it.
- IMPORTANT: Do NOT read or execute any files under `~/.claude/`, `~/.agents/`, `.claude/skills/`, or
  `agents/`. Do NOT modify `agents/openai.yaml`. Stay focused on repository code only.

## Report (end of log)
STATUS / source used for the option API + OCC format / files created / tsc result / test output /
any deviation + why.
