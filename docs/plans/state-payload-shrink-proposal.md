# Proposal: shrink `GET /api/signal-monitor/state` (~10 MB)

Read-only audit. Prepared for Riley. **No API changes made.** Every consumer claim carries file:line
evidence and is tagged observed / inferred.

---

## 0. The headline finding first (it reframes the whole task)

Two measured facts change what "shrink" means here:

1. **The wire is already ~1.15 MB, not ~10 MB.** The response is served `content-encoding: gzip`
   (observed header, and `artifacts/api-server/src/routes/signal-monitor.ts:252`). The "~10 MB" is the
   **decoded** size (parse + memory cost), not bytes on the wire.
   - Uncompressed JSON: **11,472,021 bytes** (observed, `curl -w size_download`, HTTP 200, 41.4 s).
   - Gzipped wire transfer: **1,186,010 bytes** `content-length` (observed header) ≈ 1.15 MB.

2. **No live frontend consumer polls this endpoint.** The matrix UI was moved to the SSE stream; a
   test now *forbids* the poll hook: `assert.doesNotMatch(source, /useGetSignalMonitorState/)`
   (`artifacts/pyrus/src/features/platform/PlatformWatchlist.test.mjs:360`, observed). A repo-wide grep
   finds `useGetSignalMonitorState` / `getSignalMonitorState(` / raw `/signal-monitor/state` fetches
   only in the generated client, the backend, and tests — **zero mounted frontend readers** (observed).

So the real cost is **server-side CPU** (stringify + zod-parse of 11.47 MB per cache miss) and
**client decode/memory**, not network. And the endpoint is serving rows almost nobody reads over HTTP.

---

## 1. Measured reality

`GET /api/signal-monitor/state` (authenticated, admin session). The `environment` query param is the
only documented parameter (`lib/api-spec/openapi.yaml:3323`), and the route **ignores it** — it calls
`resolveSignalSourceEnvironment()` and keys the cache on that (`routes/signal-monitor.ts:320-321`), so
there is exactly one effective response regardless of params.

| Metric | Value (observed) |
|---|---|
| Uncompressed bytes | 11,472,021 |
| Gzip wire bytes | 1,186,010 (~9.7x) |
| `states` rows | 12,000 = 2,000 symbols x 6 timeframes (1m,2m,5m,15m,1h,1d) |
| `states` share of payload | 11,455,203 B = **99.85%** (everything else = 16.8 KB) |
| Per row | 22 fields |
| Server response time | 41.4 s cold; flight recorder shows 12–18 s `api-db-query-slow` events today |

### Per-field byte breakdown across all 12,000 rows (uncompressed)

| Field | value bytes | % of states | null rows |
|---|---:|---:|---:|
| **filterState** | 4,126,741 | **58.6%** | 4,827 empty |
| id | 478,234 | 6.8% | 0 |
| profileId | 456,000 | 6.5% | 0 (constant) |
| lastEvaluatedAt | 312,000 | 4.4% | 0 |
| latestBarAt | 286,920 | 4.1% | 1,140 |
| actionBlocker | 178,104 | 2.5% | 43 non-null |
| lastError | 117,540 | 1.7% | 10,860 null |
| currentSignalPrice | 84,117 | 1.2% | 4,818 |
| currentSignalMae/MfePercent | 158,684 | 2.3% | 4,901 |
| (remaining 12 fields) | ~430,000 | ~6% | — |
| **JSON key names (all nesting)** | **6,874,241** | **60.0% of raw** | — |

Two structural facts:
- **`filterState` dominates the value bytes.** Inside it, `directionalFeatures` (a computed feature
  sub-object) is 2,585,572 B raw (**22.6%** of states); its constant `"version":"directional-features-v1"`
  string alone repeats to 242,165 B.
- **60% of the raw payload is repeated key names** — but see §3: gzip already eliminates this, so it is
  *not* a real wire lever.

---

## 2. Consumer audit (who reads the HTTP poll, and which fields)

### 2a. Every reader found (repo-wide grep, excl. node_modules/dist/worktrees)

| Consumer | File:line | Reads row fields over HTTP? |
|---|---|---|
| Frontend matrix UI | uses SSE stream, **not** poll; `PlatformWatchlist.test.mjs:360-364` forbids the hook | **No** |
| SettingsScreen (cache mgmt) | `screens/SettingsScreen.jsx:859,893` | **No** — only uses the query *key* to `invalidateQueries` / `setQueryData` |
| Evaluate POST result | `features/platform/PlatformApp.jsx:4400` | Reads **`data.states.length` only** (toast count) |
| Backend signal-options automation | `services/signal-options-automation.ts:2858-2892` | **In-process service call, not HTTP** — see 2c |
| route-admission (throttle) | `services/route-admission.ts:349` | No — lists path for concurrency admission only |
| queryPersistence guard | `app/queryPersistence.test.mjs:38` | No — asserts it is **never** persisted (trading-safety) |
| mcp-server / scripts | — | **None** (only historical perf reports name the slow route) |

Generated client entry points (unused by product code): `getSignalMonitorState`
(`lib/api-client-react/src/generated/api.ts:10138`), `useGetSignalMonitorState` (`:10186`).

### 2b. Per-field consumer matrix — for the HTTP poll specifically

Because no mounted frontend hook subscribes to this query, **every one of the 22 row fields has zero
HTTP field readers.** The nearest things touching the response:
- SettingsScreen writes the *whole* payload into the react-query cache for
  `getGetSignalMonitorStateQueryKey` (`SettingsScreen.jsx:893`) — but no component reads that key, so
  the write has no subscriber (inferred: `invalidateQueries` at `:859` also no-ops with no observer).
- PlatformApp reads only `states.length` from the *evaluate POST* response (`PlatformApp.jsx:4400`).

### 2c. The one field-level dependency — and why the HTTP shape is free to change

`listSignalOptionsSignalSnapshots` calls the **service function** `getSignalMonitorState(...)` directly
(`signal-options-automation.ts:2860`), not the HTTP route, and only as a *fallback* when
`preferStoredMonitorState` is false (the fast path is a direct DB read, `:2859`). From each row it reads
**`symbol`, `timeframe`, `currentSignalDirection`, `currentSignalAt`, `barsSinceSignal`** (via
`isSignalOptionsActionableSignalState`, `:2952-2957`) plus `profile.timeframe` / `profile.freshWindowBars`.
It does **not** read `filterState`. Because this is an in-process call, **shrinking the HTTP
serialization does not touch it** — the route can project a leaner payload while the service keeps
returning full objects. (observed)

### 2d. SSE stream relationship — does the frontend need the poll at all?

**No.** The matrix truth is the SSE stream `GET /signal-monitor/matrix/stream`
(`routes/signal-monitor.ts:171`, spec `openapi.yaml:3262`). The frontend renders
`signalMatrixSnapshot.states` from the stream (`PlatformWatchlist.test.mjs:337-357`). The stream row
(`SignalMonitorMatrixState`, `openapi.yaml:15665`) is actually **richer** than the poll row (adds
`indicatorSnapshot`) — and `directionalFeatures` is consumed by the frontend's *algo* path
(`screens/algo/algoHelpers.js`, 19 refs) fed by the stream, **not** by this poll. So `filterState`/
`directionalFeatures` is redundant in the poll for the frontend and unused by backend automation.

### 2e. Conflict surfaced (must resolve before acting)

The cache comment says *"The matrix display polls this ~every 60s per tab"*
(`routes/signal-monitor.ts:245`). This is **stale**: git dates the comment to 2026-07-02 (`533b76c2`),
while the test retiring the poll landed 2026-07-05 (`0c284e27`). **The newer test wins**; the comment
should not be trusted as evidence of a live poller. (observed via `git log -L`)

---

## 3. Shrink options, sized honestly (all gzip = wire, measured with gzip -6)

Baseline: raw 11,472,019 / **gzip 1,150,732**.

| Option | raw | gzip (wire) | wire saved | server stringify/parse saved |
|---|---:|---:|---:|---:|
| (a1) drop `directionalFeatures` | 8.88 MB | 732 KB | 419 KB (36%) | ~23% raw |
| (a2) drop `filterState` entirely | 7.17 MB | 653 KB | 497 KB (43%) | ~37% raw |
| (a3) drop `profileId` (456 KB constant) | 10.86 MB | 1,144 KB | **5.8 KB (0.5%)** | ~4% raw |
| (b1) window to profile timeframe only (2k rows) | 2.29 MB | 258 KB | 892 KB (78%) | ~80% raw |
| (b2) `fresh`-only rows (76 rows) | 0.11 MB | 20 KB | 1,131 KB (98%) | ~99% raw |
| (c) lean projection, 15 fields, drop nulls | 3.55 MB | 248 KB | 903 KB (78%) | ~69% raw |
| (d) ultra-lean, 7 fields, drop nulls | 1.56 MB | **90 KB** | 1,061 KB (92%) | ~86% raw |

Note: `active` is `true` on all 12,000 rows, so it does **not** window anything.

**(a) drop/lean fields.** Real, because filterState numbers carry entropy gzip can't collapse.
Consumer changes: none for the frontend (no reader); none for backend automation (in-process, doesn't
read filterState). API-shape risk: `filterState` is already typed `JsonObject|null` and is **required**
— dropping a required field is a breaking spec change → regen `lib/api-zod` + `lib/api-client-react`.
**Effort S** (route-level projection).

**(a3) key/constant de-dup / columnar re-encoding — REJECT.** Proof: dropping the 456 KB constant
`profileId` saves **5.8 KB on the wire** because gzip already collapses the repeat. The "60% is key
names" figure is a raw-byte artifact; gzip nullifies it. A columnar rewrite would add complexity for
near-zero wire benefit. Skip it.

**(b) pagination / windowing.** Biggest lever and semantically honest: the endpoint serves all 6
timeframes; a `?timeframe=` / `?limit=` param cuts rows proportionally. Risk: changes list semantics;
needs param + spec. **Effort M.** But note: with no live poller, there is little to page *for*.

**(c) delta / `If-None-Match` (ETag).** Low value here. There is no repeat poller to benefit, and the
route already has a 15 s serialized-payload cache with in-flight dedup (`routes/signal-monitor.ts:254-356`)
that solves the concurrent-poll problem it was built for. **Skip** unless a polling consumer returns.

**(d) bootstrap-then-stream / deprecate.** Since the frontend already lives on the SSE stream and the
evaluate POST only needs `states.length`, the poll's rows are effectively vestigial over HTTP. Options:
lean the route to a summary + ultra-lean rows (**90 KB wire, 86% less server CPU**), or deprecate the
GET after a confirmation window and delete SettingsScreen's dead cache writes. **Effort S–M.**

---

## 4. Recommendation

**Primary: treat this as a dead/over-served endpoint, not a compression problem.**

1. **Confirm zero live callers** (1 hr): watch access logs / flight recorder for `/signal-monitor/state`
   over a normal session with the matrix open. Static evidence already says zero; confirm at runtime.
2. If confirmed, **have the route serve a lean projection** (option d/c-lean): drop `filterState` +
   `directionalFeatures` and null fields, keep the ~15 identity/signal fields. Measured **248 KB wire
   (78% less), ~69% less server stringify/parse CPU**, and it kills the 12–18 s stringify stalls. The
   service and backend automation are untouched (in-process). **Effort S.**
3. **Delete the no-op cache writes** in `SettingsScreen.jsx:859,893` (they feed a query nobody reads).
4. Apply the same lean shape to the shared **evaluate POST** response (`PlatformApp.jsx` needs only
   `states.length`) — same schema, so it comes for free.
5. **Explicitly reject** columnar/key-dedup (a3) and ETag/delta (c): gzip already handles key repetition
   (profileId proof: 5.8 KB), and the 15 s cache already handles concurrent polls.

**Do NOT** invest in de-duplicating repeated keys/constants — measured wire savings are negligible.

The single most important thing to verify with Riley before any change: **is there any external/private
consumer of this HTTP endpoint (dashboards, monitors, partners) that the repo grep can't see?** If not,
the lean projection is safe and high-leverage. If yes, keep the full shape behind an opt-in param and
serve lean by default.
