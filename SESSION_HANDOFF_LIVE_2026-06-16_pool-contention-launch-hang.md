# SESSION HANDOFF (LIVE) — Pool-contention / STA "degraded|stale" banner / launch-hang

- **Date/time:** 2026-06-16 ~12:35 MT (18:35 UTC)
- **Runtime:** Claude Code recovery session `a3372ce9-1a57-4e2a-9cfd-75dd3017f808` (CWD `/home/runner/workspace`)
- **Provenance:** Reconstructed from screenshot `samples/6-16 reconect lost sessions.png` (pane 2) after a Replit container restart at ~12:25 MT dropped the original multi-pane Claude session. The original conversation transcript did **not** survive the reset — this note is the only durable record of this workstream. Sibling dropped workstreams: signals scan-deprecation (`SESSION_HANDOFF_LIVE_2026-06-16_signals-scan-deprecation-audit.md`, session `5b7a1ccb`), broker-connection UI audit (`BROKER_CONNECTION_UI_AUDIT_2026-06-16.md`).

## Recovered analysis (from dropped session, pane 2 — TO BE RE-VERIFIED against source)
- The algo/STA screen **status banner** ("bot DB data sources just timed out / went stale") is a **symptom of DB pool contention**, not an independent bug. Same root cause as the slow page load and the launch hang.
- The banner is reportedly driven by **`degraded || stale` from `cockpit/state`**. It is NOT the dead `cacheStatus === 'unavailable'` branch (separate full-screen "Deployment Data Unavailable", which the backend reportedly never triggers). Different code path, same pool cause.
- Approved fix set ("yes please" after 52m analysis), in this order:
  1. **Observability hook (#3) FIRST** — instrument the pg pool counters (total / idle / waiting) so we can watch them move in lockstep with the banner appearing. Confirms the pool-contention theory before changing behavior.
  2. **Fan-out cap** — bound the concurrent fan-out (per-deployment queries) that exhausts the pool.
  3. **Worker advisory-lock on a dedicated connection** — move the background worker's `pg_advisory_lock` off the shared pool onto its own connection so it stops holding a pooled client.
  - (Also noted: **cache the deployments list** to cut repeat fan-out.)

## Current step
- Grounding the recovered analysis in actual source (fact-first — the dropped session admitted an earlier wrong note, so re-verify before editing). Locating: cockpit/state banner + degraded/stale derivation; the dead `cacheStatus === 'unavailable'` branch; pg Pool config; the worker advisory-lock; the deployments fan-out.

## Next step
- Implement observability hook #3 (pool-counter instrumentation) first, then the fan-out cap, then the worker dedicated-connection fix.

## Related committed work (context — confirm overlap before editing)
- `711ba02 fix(account): settle the account section on a timeout to stop a launch hang`
- `e0f1259 test(account): cover cache-first live serve + bounded last-live retain`

## Validation (planned)
- `pnpm --filter @workspace/api-server run typecheck`
- If any artifact dev script / startup / pool config changes: `pnpm run audit:replit-startup` (per CLAUDE.md).
- Restart is USER-controlled; runtime changes take effect on api-server restart.
