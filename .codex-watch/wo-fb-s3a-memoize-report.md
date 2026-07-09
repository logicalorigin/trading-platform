# WO-FB-S3A memoize report

## What changed

- `artifacts/api-server/src/lib/values.ts:197`: added a module-level `Map<string, string>` for `normalizeSymbol`, capped by clearing before insert when size is `>= 8192`. The raw `symbol` string is the cache key. The computed path still runs the existing `trim().toUpperCase()`, regex test, and optional `.replace(/[ -]/, ".")` logic before storing and returning the result.
- `artifacts/api-server/src/services/signal-monitor.ts:4454`: added a `WeakMap<SignalMonitorBarSnapshot[], SignalMonitorReferenceBarCandidate[]>` keyed by `input.referenceBars` array identity. `resolveSignalMonitorReferenceBar` now gets or computes the sorted reference-bars-only candidate list, then applies `entry.reference !== input.bar` per call before leaving the prior/fallback selection logic unchanged.

## Starting dirty-state

Observed before edits:

```text
$ git diff --stat -- artifacts/api-server/src/services/signal-monitor.ts
```

No output.

```text
$ git status --short -- artifacts/api-server/src/lib/values.ts artifacts/api-server/src/services/signal-monitor.ts
```

No output.

The work-order brief noted `signal-monitor.ts` as dirty, but this checkout showed both target files clean at start.

## Verification

Typecheck command:

```text
$ pnpm --filter @workspace/api-server run typecheck

> @workspace/api-server@0.0.0 typecheck /home/runner/workspace/artifacts/api-server
> node ../../scripts/run-validation-command.mjs --label typecheck -- tsc -p tsconfig.json --noEmit
```

Observed exit: `0`.

Focused tests command:

```text
$ pnpm --filter @workspace/api-server exec tsx --test src/services/signal-monitor*.test.ts src/services/signal-options*.test.ts
...
✔ live-context gate is ON only for 1/true (case-insensitive) (0.237471ms)
✔ live-context gate falls back to the non-prefixed sibling (0.10886ms)
✔ enforce gate is OFF by default and ON only for 1/true (shadow-first) (0.156121ms)
✔ live context and enforce are independent gates (decoupled) (0.091962ms)
ℹ tests 442
ℹ suites 0
ℹ pass 442
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 296387.817641
```

Observed exit: `0`.

## Purity confirmation

- `normalizeSymbol` uncached computation depends only on its `symbol` argument via string trimming/casing, the existing regex test, and the existing replacement.
- `resolveSignalMonitorReferenceBar` cached candidate computation depends only on the `referenceBars` array contents and pure helpers observed in source: `signalMonitorBarTimestampMs`, `isSignalMonitorLiveEdgeBar`, and `signalMonitorBarClose`. The per-call `barMs` guard and `entry.reference !== input.bar` exclusion remain outside the WeakMap cache.

## Byte-identical argument

The original reference pipeline filtered `reference !== input.bar`, non-live-edge, non-null close, non-null timestamp, then sorted ascending by timestamp. The cached pipeline computes the same sorted list except for `reference !== input.bar`, then applies that exclusion afterward.

Those filters are independent predicates over each entry. Removing `input.bar` from the sorted superset cannot reorder the remaining entries, and V8's stable sort preserves equal-timestamp ordering. The resulting `references` sequence has the same surviving bar objects and timestamps as before, so the unchanged `prior` pick and nearest fallback return the same `SignalMonitorBarSnapshot` result.

For `normalizeSymbol`, the first miss computes exactly the previous output for the raw input and later hits return that stored string for the same raw key.

## Risks

- The WeakMap assumes callers do not mutate a reused `referenceBars` array after it has been cached. The hot path described in the work order reuses a stable base-bars array; mutation would have been outside the verified pure-cache assumption.
- The `normalizeSymbol` cache clears wholesale at 8192 raw-symbol keys, as requested. This is bounded but not LRU.

## Final diff stat

```text
 artifacts/api-server/src/lib/values.ts             | 17 ++++++++-
 .../api-server/src/services/signal-monitor.ts      | 44 +++++++++++++++-------
 2 files changed, 46 insertions(+), 15 deletions(-)
```
