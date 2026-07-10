# WO-DEPLOY-ACCTS (Phase A, backend) — deployment targets MULTIPLE accounts + sizing %s

Owner: codex worker (gpt-5.6-sol, xhigh, full access). Dispatcher: Claude session f19220d5.
Discipline: ponytail (full). Log: `.codex-watch/wo-deploy-accts.log`. Do NOT commit; dispatcher lands.
SCOPE: STORE + VALIDATE + EXPOSE only. Do NOT change order routing/placement — multi-account fan-out is a
separate follow-up. Keep all existing single-account behavior working.

## Goal
Let an algo deployment carry (1) a LIST of target broker/shadow accounts it controls — one or many, and
across different brokers — and (2) position-sizing percentage controls. Today a deployment stores a single
`providerAccountId`. This adds the multi-account selection + sizing config, backward-compatibly, WITHOUT a DB
migration (use the existing `config jsonb`).

## Verified anchors (study these first)
- Table `algoDeploymentsTable` (lib/db/src/schema/automation.ts:52-75): single `providerAccountId varchar
  NOT NULL` + freeform `config jsonb`.
- `CreateAlgoDeploymentInput` (services/automation.ts:40-47) — single `providerAccountId: string` + `config?`.
- create/update + `deploymentToResponse` in services/automation.ts (~929, 946, and the response builder).
- Create/update route: routes/automation.ts (~line 204, `readRequiredString` for providerAccountId).
- `normalizeAlgoDeploymentProviderAccountId` (services/algo-deployment-account.ts) — shadow coercion.
- Ownership check: services/automation-authorization.ts:33-52 (LEFT JOINs brokerAccountsTable /
  shadowAccountsTable by app user). Extend this to validate a LIST.

## Data model (no migration — store in config jsonb)
- `config.targetAccounts`: `Array<{ provider: string; accountId: string }>` — the accounts this deployment
  controls. `accountId` is the broker_accounts row id (or the shadow account id); `provider` in
  {robinhood, snaptrade, schwab, ibkr, shadow}. May span multiple brokers.
- `config.sizing`: `{ positionSizePct: number|null; allowancePct: number|null; maxLossPct: number|null }`
  (each 0-100 or null). positionSizePct = per-position size as % of the account's buying power; allowancePct =
  max % of buying power the deployment may use in an account; maxLossPct = stop threshold as % (loss).
- Keep the `providerAccountId` COLUMN: when `targetAccounts` is non-empty, set the column to the FIRST entry's
  accountId (backward compat + existing single-account code paths keep working). When `targetAccounts` is
  absent, DERIVE it as `[{ provider: <inferred>, accountId: providerAccountId }]`.
- Add helper `resolveDeploymentTargetAccounts(deployment)` returning the normalized array (fallback to the
  single providerAccountId). Add a sizing normalizer that clamps each pct to [0,100] or null.

## Deliverables (api-server)
1. Extend `CreateAlgoDeploymentInput` (+ the update input) with optional `targetAccounts?` + `sizing?`; persist
   them into `config` on create/update; set `providerAccountId` column from the first target account.
2. `deploymentToResponse` exposes `targetAccounts` + `sizing` (from config, with the backward-compat derivation).
3. Ownership validation: for EACH account in `targetAccounts`, assert it belongs to the app user (extend the
   automation-authorization ownership query to accept a list; reject create/update with a clear HttpError
   `algo_deployment_account_not_owned` naming the offending accountId if any is not owned). Shadow accounts
   allowed for shadow mode; live broker accounts for live mode (mirror existing mode gating).
4. Route (routes/automation.ts): parse optional `targetAccounts` (array of {provider, accountId}) + `sizing`
   from the body on create/update; pass through. Add the zod/contract for these (follow the existing
   pattern the automation route uses — generated api-zod or local zod; if generated, regen; if the route
   already uses local parsing, extend it).
5. Tests (services/automation.test.ts or a new sibling): create with 2+ targetAccounts across brokers + sizing
   → stored + returned; unowned account → rejected; absent targetAccounts → derived from providerAccountId
   (backward compat); providerAccountId column = first target.

## Hard constraints
- Do NOT modify signal-options-automation order mapping, overnight-spot-execution placement, shadow-account
  writes, broker-execution.ts, or tandem files (snaptrade-account-portfolio.ts, signal-monitor.ts). Order
  fan-out to multiple accounts is a SEPARATE follow-up — this WO only stores/validates/exposes the selection.
- No commit/stash. Do not read/execute under ~/.claude/, ~/.agents/, .claude/skills/, agents/; do not modify
  agents/openai.yaml.

## Verify (paste in log)
```bash
cd /home/runner/workspace/artifacts/api-server
npx tsc -p tsconfig.json --noEmit 2>&1 | grep -E "error TS" | grep -iE "automation|algo-deployment" || echo "(clean)"
node --import tsx --test src/services/automation.test.ts 2>&1 | tail -6
```

## Report (end of log)
STATUS / files changed / how targetAccounts + sizing are stored + exposed / ownership validation approach /
route contract change (generated vs local) / tsc + test results / the exact create/update body shape the
frontend should send / any deviation.
