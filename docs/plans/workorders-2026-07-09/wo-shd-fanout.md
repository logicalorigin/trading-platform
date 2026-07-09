# WO-SHD-FANOUT — Shadow account-page read fanout: closed-trades/tax (13.8s) + risk-build dedupe

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** Headless fix worker. No
> SESSION_HANDOFF_* writes; don't read ~/.claude/, .claude/skills/, agents/, AGENTS.md session
> sections. NEVER restart/reload/signal the app (no REPLIT_MODE=workflow — retired), never
> `git push`, no DB maintenance. 2-core live box: only listed validations. PRECONDITION:
> `git status --short -- artifacts/api-server/src/services/shadow-account.ts` clean; if dirty
> (another session's live WIP), wait 60s ×15 then BLOCKED. Never `git add -A`. index.lock → sleep
> 10s, retry. Minimum diff; byte-identical route outputs for identical data.

## Measured evidence

- Route p95 (runtime monitor, 2026-07-09): `/accounts/shadow/closed-trades` **13,846ms**,
  `/accounts/shadow/tax/overview` **13,746ms**, `/accounts/shadow/risk` 3,556ms; risk-build ops
  observed re-running 1-10s each repeatedly per account-page mount (shadowAccountReads recent log).
- Census: `readBoundedShadowFillsWithOrders` / 'dashboard:fills-with-orders'
  (shadow-account.ts:3269) — up to 20,000-row scan feeding EVERY account-page widget + SSE
  snapshot; a code comment names it the startup pool-saturation root cause; single-flight + 30s
  TTL exist but each cold hit is enormous, ~1.7s. Cache infra: `withShadowReadCache`
  (shadow-account.ts:3463), TTL 2.5s / stale 60s.
- One screen mount hits closed-trades + tax/overview + tax/events + risk + positions + summary,
  each independently folding the same ledger.

## Mandate

1. **Trace first** (report section required): for the three slow routes + risk-build, the exact
   read/fold chain (file:line) and which parts are SHARED per (account, ledger-version).
2. **Share the fold, not just the rows**: derive the shared ledger bundle/fold ONCE per
   (account, ledger-version) and let closed-trades/tax/risk consumers project from it — extend the
   existing withShadowReadCache/single-flight machinery (reuse its keying + invalidation via
   ledger version/notifyShadowAccountChanged) rather than adding a new cache layer. Consumers that
   need FRESH trading-adjacent reads (order placement paths) must keep them — list them explicitly.
3. **Bound what each consumer folds**: if closed-trades/tax fold the full 20k bundle but present a
   bounded window, push the bound into the read (cite the consumer's actual window).
4. Route outputs byte-identical for identical data (the projections must not reorder/re-round).

## Tests
- Fold-sharing: two consumers, one underlying computation (spy/counter via existing test seams).
- Invalidation: a new fill/order bumps the ledger version → next read recomputes.
- Freshness carve-outs: the listed trading-adjacent reads bypass the shared fold.
- Existing shadow suites green.

## Validation
1. `pnpm --filter @workspace/api-server run typecheck` → EXIT 0.
2. `pnpm --filter @workspace/api-server exec tsx --test --test-force-exit src/services/shadow-account*.test.ts` → 0 fail; counts.

## Files you may touch
- `artifacts/api-server/src/services/shadow-account.ts` (+ shadow test files)

## Commit
`perf(shadow-account): share the account-page ledger fold across closed-trades/tax/risk consumers (WO-SHD-FANOUT)` + evidence lines incl. before route p95s.

Do NOT push. Report: `.codex-watch/wo-shd-fanout-report.md`; final message 3 lines.
