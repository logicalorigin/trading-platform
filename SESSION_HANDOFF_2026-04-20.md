# Session Handoff — 2026-04-20

## Project intent

Internal trading platform for:

- Equities and options
- Paper and live modes
- Polygon/Massive for market data
- Interactive Brokers for broker connectivity / execution
- Photonics / thematic research embedded directly into the app

User constraints and decisions already established:

- Internal-use only
- Options are day 1 scope
- User will load provider credentials through Replit secrets
- IBKR wiring is required
- Research tab must absorb `Imports/photonics-dashboard (1).jsx`

## What is already implemented

### Platform API and schema

The OpenAPI contract was expanded beyond health checks into a real platform API in:

- `lib/api-spec/openapi.yaml`

Core platform routes now exist for:

- session
- broker connections
- accounts
- watchlists
- positions
- orders
- quote snapshots
- bars
- options chains
- flow events

Generated clients/schemas were already regenerated under:

- `lib/api-client-react/src/generated/*`
- `lib/api-zod/src/generated/*`

### Database

Drizzle schema modules were added under:

- `lib/db/src/schema/*`

The app now uses Postgres-backed watchlists via:

- `artifacts/api-server/src/services/platform.ts`

A default `Core` watchlist is seeded if the DB is empty.

### Provider adapters

Platform API adapters already exist for:

- Polygon/Massive market data
  - `artifacts/api-server/src/providers/polygon/market-data.ts`
- IBKR execution / account access
  - `artifacts/api-server/src/providers/ibkr/client.ts`

Runtime env parsing exists in:

- `artifacts/api-server/src/lib/runtime.ts`

### API server integration

Platform routes are active in:

- `artifacts/api-server/src/routes/platform.ts`

Research routes were added in this session:

- `artifacts/api-server/src/routes/research.ts`

Research service/provider files added in this session:

- `artifacts/api-server/src/services/research.ts`
- `artifacts/api-server/src/providers/fmp/client.ts`

Research endpoints now available:

- `GET /api/research/status`
- `GET /api/research/fundamentals?symbol=...`
- `GET /api/research/earnings-calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/research/sec-filings?symbol=...`
- `GET /api/research/transcripts?symbol=...`
- `GET /api/research/transcript?symbol=...&quarter=...&year=...`

These are designed so research credentials stay server-side.

### Frontend shell

The app shell was already moved onto:

- `artifacts/rayalgo/src/app/App.tsx`
- `artifacts/rayalgo/src/app/AppProviders.tsx`
- `artifacts/rayalgo/src/features/platform/RayAlgoApp.tsx`

The main monolithic platform surface remains:

- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`

### Research tab integration completed this session

The imported research file was copied into the app here:

- `artifacts/rayalgo/src/features/research/PhotonicsObservatory.jsx`

The Research tab now mounts the real Photonics module instead of the placeholder scaffold:

- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`

Key changes made to the imported research module:

- Removed hardcoded browser-side FMP API key behavior
- Removed direct browser-side FMP fetch dependency
- Removed direct browser-side Anthropic request path
- Added server-backed fetches for:
  - quotes
  - bars
  - fundamentals
  - earnings calendar
  - SEC filings
  - transcript lists
  - transcripts
- Added graceful offline / unconfigured behavior when research secrets are absent
- Added `Open in Trade` cross-navigation from research detail
- Scoped its style block under `.photonics-research-root` so it does not globally overwrite the rest of the trading app

## Current status of secrets in this environment

At the time of this handoff, the current workspace environment only exposed DB variables.

Observed:

- `DATABASE_URL` exists
- Polygon secret not currently visible here
- IBKR secret not currently visible here
- Research/FMP secret not currently visible here

Smoke tests showed:

- `GET /api/session` returned `configured.polygon=false` and `configured.ibkr=false`
- `GET /api/research/status` returned `configured=false`
- `GET /api/research/fundamentals?symbol=NVDA` returned a clean `503 research_not_configured`

That is expected behavior until secrets are loaded.

## Secrets expected by the code

### Polygon / Massive

Accepted env names:

- `POLYGON_API_KEY`
- `POLYGON_KEY`
- `MASSIVE_API_KEY`
- `MASSIVE_MARKET_DATA_API_KEY`

Optional base URL env names:

- `POLYGON_BASE_URL`
- `MASSIVE_API_BASE_URL`

### IBKR

Accepted base URL env names:

- `IBKR_API_BASE_URL`
- `IB_GATEWAY_URL`
- `IBKR_GATEWAY_URL`

Accepted auth env names:

- `IBKR_OAUTH_TOKEN`
- `IBKR_AUTH_TOKEN`
- `IBKR_BEARER_TOKEN`
- `IBKR_COOKIE`
- `IBKR_SESSION_COOKIE`
- `CP_GATEWAY_COOKIE`

Optional account/operator env names:

- `IBKR_ACCOUNT_ID`
- `IBKR_DEFAULT_ACCOUNT_ID`
- `IBKR_EXT_OPERATOR`
- `IBKR_USERNAME`
- `IBKR_EXTRA_HEADERS_JSON`

### Research provider

Accepted research secret env names:

- `FMP_API_KEY`
- `FMP_KEY`
- `FINANCIAL_MODELING_PREP_API_KEY`
- `FINANCIALMODELINGPREP_API_KEY`

Optional base URL:

- `FMP_BASE_URL`
- `FINANCIAL_MODELING_PREP_BASE_URL`

## What was verified successfully

Commands that passed:

- `pnpm --filter @workspace/api-server run typecheck`
- `pnpm --filter @workspace/api-server run build`
- `env PORT=18772 BASE_PATH=/ pnpm --filter @workspace/rayalgo run build`
- `pnpm run typecheck`

The frontend build does currently warn about a large JS chunk after the Research import. It still builds successfully.

## Important architectural notes

### Research module

The imported `photonics-dashboard` file is not a small widget. It is effectively a standalone research application embedded into the platform. It includes:

- large static company universe
- thematic graph exploration
- detail pages
- calendar views
- filings and transcript surfaces
- valuation / scenario panels

Because of that:

- it should stay isolated in its own feature module
- it should eventually be lazy-loaded / code-split
- it should continue moving provider access behind the platform API

### AI scenario engine

The original import had a direct browser call to Anthropic. That was intentionally removed.

Reason:

- model credentials should not live in the browser
- the request was missing required Anthropic auth headers
- server-side orchestration is the correct design boundary

If scenario analysis is wanted, it should be reintroduced as:

- server route
- secret-backed provider client
- explicit prompt / output schema

## Next recommended execution steps

### Phase 1: Secrets and runtime bring-up

1. Load Polygon/Massive secrets
2. Load IBKR gateway/auth secrets
3. Load FMP secret if research fundamentals / filings / transcripts should remain enabled
4. Re-run API smoke tests against:
   - `/api/session`
   - `/api/accounts`
   - `/api/watchlists`
   - `/api/quotes/snapshot`
   - `/api/research/status`
   - `/api/research/fundamentals?symbol=NVDA`

### Phase 2: Research <-> platform coupling

1. Persist research selections into platform watchlists
2. Add watchlist actions from the research detail screens
3. Expose active positions / account context inside research views
4. Continue tightening Research -> Trade navigation
5. Lazy-load the research tab to reduce bundle size

### Phase 3: Trading platform completion

1. Persist orders / executions / broker snapshots into DB
2. Add proper portfolio/account sync jobs
3. Wire options chain and order ticket deeper into live broker data
4. Add durable audit/history tables for internal usage
5. Build paper/live mode switching intentionally across the UI

### Phase 4: AI / research augmentation

1. Decide on Anthropic vs OpenAI for scenario engine
2. Add a server-side model route
3. Define strict response schema for scenario analysis
4. Reconnect valuation tab scenario engine to that route

## Open questions still needing a user answer

1. Should research fundamentals / calendar / filings / transcripts stay on FMP, or should another provider replace it?
2. Which provider should power the scenario engine server-side: Anthropic or OpenAI?
3. What should be prioritized next:
   - research/watchlist sync
   - broker/account persistence
   - order workflow completion

## Useful files to resume from

- `artifacts/rayalgo/src/features/research/PhotonicsObservatory.jsx`
- `artifacts/rayalgo/src/RayAlgoPlatform.jsx`
- `artifacts/api-server/src/routes/research.ts`
- `artifacts/api-server/src/services/research.ts`
- `artifacts/api-server/src/providers/fmp/client.ts`
- `artifacts/api-server/src/services/platform.ts`
- `artifacts/api-server/src/providers/ibkr/client.ts`
- `artifacts/api-server/src/providers/polygon/market-data.ts`
- `artifacts/api-server/src/lib/runtime.ts`

## Notes on worktree state

The repository already had unrelated user changes and untracked content when this work was being done, including:

- `.replit` modified
- `Imports/` present

Those were not reverted.
