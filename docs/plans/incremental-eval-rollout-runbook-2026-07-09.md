# Incremental signal-eval rollout runbook (PYRUS_SIGNALS_INCREMENTAL_EVAL)

Prereqs: S3B-3 landed (lastBarClosed parameterization — review P1 fix), then the S3B-2 wiring
landed (flag off|shadow|on, shadow-parity sampling, LRU-bounded instances). Engine parity: 11
golden fixtures, byte-identical at every append (commit dffa255e + S3B-3 extension).

## Stage 0 — OFF (current)
Flag unset/off: from-scratch evaluator only, zero behavior change. Nothing to do.

## Stage 1 — SHADOW soak (≥1 full RTH session)
1. Set `PYRUS_SIGNALS_INCREMENTAL_EVAL=shadow` in `.replit` `[userenv.development]` (the startup
   contract's env surface — same place as IBKR_ASYNC_SIDECAR_ROUTING_ENABLED). Remember the
   startup-config guard: run `pnpm run audit:replit-startup` after editing `.replit`.
2. SIGUSR2 reload (same-pid safety check per the verification runbook).
3. Soak through a market open + midday. Acceptance (read from the signal-monitor diagnostics
   surface the wiring exposes): `shadowChecks` climbing, **`shadowMismatches` = 0**, appends ≫
   seeds (seed storms would mean the extension-detection misfires — investigate, don't proceed).
4. ANY mismatch: capture the logged divergence, flip flag off, file the fixture that reproduces it
   against the parity harness. Do not proceed.

## Stage 2 — ON
1. Flip to `on`; SIGUSR2 reload; the 1-in-500 self-check keeps sampling (counter must stay 0).
2. Watch the market-open acceptance metrics (GC%, busy%, heavy-eval timing) vs the shadow-stage
   run — this is the lever the s3b gate predicted; expect the eval cluster's CPU share to drop.
3. Rollback = flip to off + reload (from-scratch path untouched the whole time).

## Owner gates
- Stage 1 → 2 requires Riley's ok with the soak numbers in hand (it changes what computes live
  signals, even with parity sampling green).
