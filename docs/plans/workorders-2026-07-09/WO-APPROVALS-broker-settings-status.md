# WO-APPROVALS — Broker settings: per-account approval/capability status (backend + UI)

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full). Log: `.codex-watch/wo-approvals.log`. Do NOT commit; dispatcher lands.

## Goal
Surface, in the broker SETTINGS area, which approvals/capabilities each connected broker account has —
so the user can see e.g. "Options: not approved → upgrade", "Agentic: enabled", "Execution-ready / blocked".
The data mostly exists; today the UI doesn't show it and the Robinhood sync drops `option_level`.

## CRITICAL — integrate, do NOT bolt on (WS4 lesson)
A prior attempt built a redundant NEW component instead of extending what exists, and it was thrown away.
Do NOT create a new screen/panel. Add the status INTO the existing broker settings panels/models.
RESEARCH THE EXISTING UI FIRST and record findings at the top of the log BEFORE writing code:
- `artifacts/pyrus/src/screens/settings/` — `SnapTradeConnectPanel.jsx`, `robinhoodConnectModel.js`,
  `schwabConnectModel.js`, `snapTradeConnectModel.js`, `brokerConnectionLifecycle.js`, and the
  SettingsScreen that renders them. Find where connected broker accounts are already listed/displayed.
- How per-account data (executionReady / executionBlockers / capabilities / agentic) currently reaches the
  frontend: trace the readiness hooks (`useGetRobinhoodReadiness`, `useGetSnapTradeReadiness`) and/or any
  accounts endpoint. Record the exact data path (endpoint → service → account rows).

## Backend
1. Capture `option_level` in the Robinhood sync (`artifacts/api-server/src/services/robinhood-account-sync.ts`):
   `normalizeAccount` already receives the raw get_accounts record (it reads `agentic_allowed` etc.); the raw
   record includes `option_level` (string, e.g. "" | "option_level_2"). Add `optionLevel` to `NormalizedAccount`
   + `RobinhoodConnectionSyncAccount`, persist it on the account row (store as a capability tag like
   `robinhood-option-level:<value>` in the existing `capabilities` string[] — NO schema migration), and include
   it in the sync response.
2. Expose it where the settings UI reads accounts. If the settings UI reads the readiness endpoint, add the
   per-account `optionLevel` (+ agentic + executionReady + executionBlockers) to that response
   (`robinhood-readiness.ts` and the api-zod/local schema the route parses). Mirror the equivalent for SnapTrade
   (executionReady + capabilities are already there) so the status row is provider-general.
   Keep it read-only: no new writes, no new external calls (option_level comes from the existing sync).

## Frontend
3. In the EXISTING settings broker panel(s), for each connected account add a compact status row:
   - Options: "Level N" when approved, or "not approved" + the upgrade link
     `https://applink.robinhood.com/upgrade_options?account_number=<full account_number>` (Robinhood only).
   - Agentic: enabled/disabled (Robinhood).
   - Execution-ready: ready, or "blocked" with the blocker reasons.
   Match the panel's existing styling/tokens. Do NOT add a new panel or screen.

## Constraints
- Backend files: robinhood-account-sync.ts (+its test), robinhood-readiness.ts (+schema/type), and the api-zod
  or local zod the readiness route parses. Frontend: only the existing settings broker panel(s) + their models.
  Do NOT touch broker-execution.ts, the order services, tandem files (shadow-account.ts,
  snaptrade-account-portfolio.ts, signal-monitor.ts, TradeScreen.jsx, TradeOrderTicket.jsx, App.tsx). No commit.
- IMPORTANT: Do NOT read or execute anything under ~/.claude/, ~/.agents/, .claude/skills/, or agents/.
  Do NOT modify agents/openai.yaml.

## Verify (paste in log)
```bash
cd /home/runner/workspace/artifacts/api-server && npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | grep -iE "robinhood-account-sync|robinhood-readiness" || echo "(clean)"
node --import tsx --test src/services/robinhood-account-sync.test.ts 2>&1 | tail -6
cd /home/runner/workspace/artifacts/pyrus && pnpm run typecheck 2>&1 | tail -4
```

## Report (end of log)
STATUS / where the existing settings account list lives (file:line) / the exact per-panel edit made /
backend files changed + how option_level is stored+exposed / tsc + typecheck + test results / deviations.
