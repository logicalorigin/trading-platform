# WO-P1-T4 — frontend minute-cache unbounded growth (useMassiveStockAggregateStream)

Codex worker, /home/runner/workspace. Target:
artifacts/pyrus/src/features/charting/useMassiveStockAggregateStream.ts (clean). Working-tree edit
only, NO git commands, no ~/.claude/ or .claude/skills/ or agents/ access.

PROBLEM (P1 unbounded growth): `minuteCacheBySymbol = new Map<...>()` (:144) is a module-level
per-symbol minute-bar map. The browser session runs all day; entries accumulate per symbol and per
minute. There is a per-symbol replace at ~:682-683 but symbols are never evicted and per-symbol bar
count is unbounded.

FIX: (a) bound bars PER SYMBOL (cap count; drop oldest minutes past the cap), and (b) evict a symbol's
cache when it has no live consumer (there is a `consumers` map + `symbolStoreListeners` — use them) or
on symbol switch. AC: per-symbol bar count capped; a symbol with no consumers is evicted.

Verify: new test asserting the per-symbol cap holds and a symbol is evicted when unsubscribed. Frontend
→ Vite hot-reloads (no API restart). Run touched suites; paste output.

Report: .codex-watch/wo-p1-t4-report.md.
