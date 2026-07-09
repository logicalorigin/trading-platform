# WO-FB2-REVIEW — Adversarial review of today's perf/fix commits (read-only, report-only)

> **HEADLESS WORKER PREAMBLE (overrides AGENTS.md session rituals):** You are a headless adversarial
> REVIEWER, not an interactive session and not a fixer. (1) Do NOT create/update any
> SESSION_HANDOFF_* file. (2) Do NOT read ~/.claude/, ~/.agents/, .claude/skills/, .agents/skills/,
> agents/, or AGENTS.md session sections. (3) READ-ONLY CONTRACT: you MUST NOT edit any file, run
> any git write command, restart/reload anything, or signal any process. (4) 2-core box under live
> load: do NOT run builds/typechecks/tests — reason from the code; light `rg`/`sed` only.

## Commits under review (verify the list against `git log` first; review each diff via `git show`)

<COMMITS — filled by dispatcher at chain drain; format: SHA — one-line description>

## Your mandate

For EACH commit, hunt the specific failure modes its class implies. You are trying to BREAK these
changes, not summarize them:

- `241e047d` + `3f89d51f` (algo frontend, SSE freshness registry + empty-state): stale-freshness
  suppression of a REAL degradation signal (registry says fresh while the actual stream died —
  trace the EventSource error path vs registry decay); memory of the registry across deployment
  churn; the AlgoScreen boolean derivations under every combination of
  {isFetching, isError, data, cacheStatus}; a REPEAT of the dangling-identifier class (grep the
  exact identifiers removed/renamed in both commits for surviving references in .jsx files — tsc
  does not check .jsx).
- `5e19cc84` (shadow recompute classification memo): memo poisoning across the generation guard
  (interleavings of update-commit vs in-tx fetch vs memoize); eviction under the 65,536 FIFO cap
  evicting a HOT id then a stale re-fetch inside an aborted tx; deleted orders whose fills remain;
  the Pick<> signature loosening at all 8 call sites.
- `26f1fba5` (backfilledBaseByCell LRU bound): eviction racing the gap-fetch promotion (promote →
  evict → read = never-backfilled fallback — is the fallback truly identical to pre-change
  behavior?); the read-touch turning scans into LRU churn; cap default vs universe growth.
- `193cd181` (parity fixtures): goldens actually pin the CURRENT evaluator (would the drift test
  catch a one-key change? spot-check one golden against a hand-derived value); the stable
  serializer's NaN/-0/Infinity handling; fixture PRNG determinism across Node versions.
- <F4A / F1B / S3B-1 commits — same treatment; for F4A specifically: can the fingerprint/signature
  memo EVER return stale for changed content (that suppresses a real SSE emission — user-visible
  signal loss, the highest-severity failure available in this review); for F1B: do the split
  counters count both branches exactly once; for S3B-1: pick 2 series and hand-verify the
  incremental arithmetic order equals the from-scratch loop order.>

Also cross-commit: interactions between 5e19cc84's memo and the codex lane's dbTrading wiring of
placeShadowOrder (different pool, same module state); 26f1fba5's bound vs F1B's diagnosis
assumptions.

## Output

`.codex-watch/wo-fb2-review-report.md`:
- Per commit: verdict SOLID or FINDINGS, with each finding as {severity P1/P2/P3, file:line,
  concrete failure scenario, evidence}. No style nits, no "consider adding" — only defects with a
  reproducible failure path.
- End with a ranked list of all findings across commits.
Final message: 3 lines max — finding counts by severity, report path.
