# PYRUS Startup Speed Plan

Date: 2026-06-11

## Summary

Optimize for the browser preview becoming usable fastest. Keep the existing PYRUS web artifact as the single startup owner, and do not edit `.replit` or artifact metadata unless a later maintenance window explicitly approves it.

Observed baseline from `/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl`:

- Supervisor launch to API health was roughly `2.1-3.1s` in recent runs.
- Current sequence is serialized: start API, wait for `/api/healthz`, then start the market-data worker, then start Vite.
- `web-started` currently means the Vite child process was spawned. It does not prove the preview is serving or that the first screen rendered.

## Key Changes

### Startup Orchestration

Update `artifacts/pyrus/scripts/runDevApp.mjs` so startup does not block the preview behind API health:

- Acquire the supervisor lock exactly as today.
- Spawn API and Vite immediately in parallel.
- Add `waitForWeb()` that polls `http://127.0.0.1:${webPort}/?pyrusQa=safe` and verifies the response is the Vite HTML shell.
- Keep `waitForApi()` ownership checks as today.
- Start the market-data worker only after API is healthy and web has been spawned.
- Prefer starting the worker after `web-ready` so worker CPU does not compete with first preview paint.
- Add lifecycle events: `api-started`, `web-started`, `web-ready`, `api-healthy`, `preview-ready`, and `worker-started`.

### Frontend Boot Resilience

Harden frontend boot against API being a little behind Vite:

- Keep the existing boot progress model.
- Allow `session` and `watchlists` boot queries to retry short network or connection failures during launch.
- Use a bounded retry window around `3-5s`.
- Do not retry normal HTTP application failures indefinitely.
- Treat first-screen readiness as the visible frame contract. Data readiness
  should surface through inline screen loading states and background-work gates,
  not a full-screen boot overlay.
- Do not make account, signal, or background warmups blocking.

### Startup Measurement

Improve measurement before and after the startup ordering change:

- Extend lifecycle evidence with deltas from `launch-start` to `api-healthy`, `web-ready`, `preview-ready`, and `worker-started`.
- Use existing browser performance metrics for `firstScreenReadyMs`.
- Add a readable safe-mode smoke script only if current metrics are not enough.
- Do not add Replit control-plane probes or generated workflows.

## Test Plan

### Static Checks

- Run `pnpm --filter @workspace/pyrus run typecheck`.
- Run `pnpm --filter @workspace/api-server run typecheck`.
- If startup scripts are touched, run `pnpm run audit:replit-startup`.

### Focused Tests

- Add tests around `runDevApp.mjs` timing/event helpers if practical without starting real servers.
- Add or update frontend tests for bounded boot-query retry behavior.

### Runtime Checks

Use the default Replit app launch, then compare lifecycle deltas before and after:

- `launch-start -> web-ready`
- `launch-start -> api-healthy`
- `launch-start -> preview-ready`
- Browser `firstScreenReadyMs`

### Acceptance Criteria

- Preview HTML is reachable before or no later than API health.
- First screen still renders cleanly when API becomes healthy slightly after Vite.
- Market-data worker no longer competes with first preview render.
- No duplicate supervisors, orphaned ports, or `EADDRINUSE` regressions.
- Startup guards still pass.

## Assumptions

- Priority is preview usability, not full live-data readiness.
- API still runs the existing build step in dev for this pass.
- Replacing API dev with watch mode or `tsx` is out of scope until measured as a real bottleneck.
- Replit startup config remains locked and unchanged.
- Live full-app browser navigation still requires explicit approval; safe-mode probes are the default validation path.
