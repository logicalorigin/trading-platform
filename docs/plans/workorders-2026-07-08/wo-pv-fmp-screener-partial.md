# WO-PV-FMP — FMP high-beta screener silently drops failed exchanges (P3, verified)

Codex worker, /home/runner/workspace. Target: artifacts/api-server/src/providers/fmp/client.ts (~:830,
the high-beta screener `Promise.all(exchanges.map(... .catch(() => [])))`). Verify clean first;
working-tree edit only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/ access. Unit tests
only.

PROBLEM (P3 silent partial data loss, CONFIRMED_REAL): each exchange fetch catches to `[]`, so a failed
NASDAQ/NYSE/AMEX slice silently yields a plausible-but-incomplete candidate universe with no telemetry.

FIX: use `Promise.allSettled`, and for each rejected exchange emit a diagnostic/log (reuse the file's
existing logging/diagnostics) identifying the failed exchange; surface that the result is partial (a
flag or logged warning) when a material slice fails. Keep returning the successful slices (don't hard-
fail the whole screener). AC: a failed exchange is logged/counted (not silent); successful slices still
returned.

Verify: targeted test where one exchange fetch rejects → assert the other slices return AND a
failure diagnostic/partial signal is emitted. Report: .codex-watch/wo-pv-fmp-report.md.
