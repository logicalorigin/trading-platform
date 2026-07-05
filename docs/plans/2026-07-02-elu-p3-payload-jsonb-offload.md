# P3 — Take jsonb `payload` parsing off the main event loop

Status: **DRAFT plan (no code yet)** · 2026-07-02 · Workstream B (DB-pool / 100% ELU)
Predecessor evidence: `SESSION_HANDOFF_LIVE_2026-07-02_db-pool-elu-saturation-rootcause-plan.md`

## Problem (measured, not inferred)

Live CPU profile of the API main thread (`.pyrus-runtime/api-cpu-*.cpuprofile`, 46k samples)
plus row-count attribution (temporary `instrumentQuery` tap, since reverted) establish:

- The loop is **CPU-bound** (~14% idle at load); the single biggest self-time frame is
  node-postgres `_parseRowAsArray` (**18.2%**) driven entirely from the socket-read callback
  (`handleDataRow ← onStreamRead`) — i.e. result parsing runs as loop callbacks, which is why
  `client.release()` lags and the 12-slot pool stays checked out (the H1 mechanism).
- The **already-safe reductions are done** (uncommitted in-tree): `bar_cache` read projected to 6
  columns (`market-data-store.ts`), `/flow/events` N+1 collapsed. The 18% is the residual **after**
  those.
- Row attribution (top residual reads by rows parsed / 45s):
  | rows | calls | table | note |
  |---|---|---|---|
  | 141,446 | 221 | `bar_cache` | already 6-col (optimal) |
  | 111,992 | 1,192 | `signal_monitor_events` | full-row incl **jsonb `payload`**, per-request |
  | 73,576 | 106 | `signal_monitor_symbol_states` | cached + wide-consumed |
  | 32,895 | 309 | `execution_events` | full-row incl **jsonb `payload`** + `text summary` |

`signal_monitor_events.payload` and `execution_events.payload` are both **`jsonb`**
(`lib/db/src/schema/signal-monitor.ts:122`, `automation.ts:86`). node-postgres registers a default
type parser for jsonb (OID 3802) that runs `JSON.parse` **per row on the main thread**. On the
high-volume event reads this jsonb parse (+ the subsequent re-`JSON.stringify` into the HTTP/SSE
response) is the dominant *reducible* residual.

## Non-goals / rejected

- **Do NOT raise `DB_POOL_MAX`** — saturation is a symptom of the pegged loop; more connections feed
  more parse work onto the same loop.
- **Worker-thread / separate-process offload of the *same* parse is NOT the default** — moving rows
  to a worker re-serializes them across the `postMessage` boundary (structured clone), which can eat
  the win. It is only worthwhile in the specific transferable-Buffer form below (Option C).
- Signal **math** is already off-loop in the `python-compute` lanes (`python-compute.ts`,
  ports 18768/18770). P3 is strictly about **DB payload parse + response serialize**, not compute.

## Options (compose; each independently measurable)

### A. Lazy / opt-in `payload` (API-shape change)
Return a lean event/exec-event shape **without** `payload` by default; expose payload via a detail
read (`/…/events/:id`) or an explicit `?includePayload=1`. Removes the jsonb parse for the common
list/poll case entirely.
- Pro: biggest structural cut where payload isn't needed inline. Con: requires UI/consumer
  coordination (who reads `payload` from the list today?). **Blocked on consumer audit.**

### B. `payload::text` passthrough (server-transparent) — for UNMODIFIED payloads only
For reads whose handler passes `payload` straight into the JSON response **unchanged**, select
`payload::text` (returned via the cheap text parser, no `JSON.parse`) and splice the raw JSON string
directly into the response — avoiding **both** the pg jsonb parse and the response re-stringify.
Output bytes are identical.
- **Caveat found:** the events read is NOT a pure passthrough — `eventToResponse`
  (`signal-monitor.ts:1447`) runs `normalizeLegacyAlgoBranding(asRecord(event.payload))`, i.e. it
  parses + mutates branding tokens + re-serializes. So B applies cleanly only after the branding
  normalization is (a) moved off the hot read, (b) made a cheap has-legacy-token fast-path skip, or
  (c) pushed into ingest so stored payloads are already normalized. **`execution_events` must be
  consumer-audited** the same way before B applies.

### C. Transferable pre-serialized Buffer from a read worker — for the hottest read+serialize path
A dedicated `worker_thread` owns a pg pool, runs the heavy read, shapes + `JSON.stringify` to a
`Buffer`, and `postMessage`s the Buffer as a **transferable** (zero-copy). Main thread writes it
straight to the socket — no parse, no stringify on the loop.
- Pro: removes parse AND serialize from the loop for one endpoint. Con: real infra; only justified
  after A/B if a single endpoint still dominates. Measure transfer vs savings first.

### D. Aggregate in SQL (fewer rows)
For reads that bucket/aggregate in JS after fetching (breadth/history), push the aggregation into SQL
so fewer rows cross the wire and get parsed. Complements A–C.

## Recommended sequence (measure between every slice)

1. **Consumer audit** (cheap, do first): who actually consumes `payload` from the
   `signal_monitor_events` list and `execution_events` list responses? Determines whether **A**
   (drop payload) is viable — the largest, cleanest win — or whether **B** is the ceiling.
2. If payload is not needed inline → **A** (lean list + detail read). Else → **B** with branding
   normalization moved to ingest / fast-path.
3. Re-profile; if one endpoint still dominates → **C** for that endpoint only.
4. **D** opportunistically for aggregate reads.
- Orthogonal, behavioral, faster: a **short-TTL cache** on the per-request events read
  (`signal-monitor.ts:14192`, mirrors the 10s states-read cache) collapses the 1,192 identical
  calls. Not part of P3 (it's a freshness tradeoff, needs product sign-off) but it is the cheapest
  single dent and can land independently.

## Verification (per slice)
- Reuse tonight's tooling: temporary `instrumentQuery` rows-by-SQL tap (revert after) for the read
  volume delta, and `scripts/diag/cpu-profile-running-api.mjs <pid> <ms>` before/after for the
  `_parseRowAsArray` + GC self-time delta, **normalized to on-CPU time** (idle level drifts between
  runs — see the timeZoneParts before/after in the handoff).
- Acceptance for slice 1 target: measurable drop in `signal_monitor_events` jsonb parse share with
  byte-identical responses (A: payload absent by design + detail endpoint parity; B: identical).

## Risks / unknowns
- **jsonb→text must be query-scoped** (`SELECT payload::text`), never a global pg type-parser
  override (would break every consumer expecting parsed objects).
- Branding normalization coupling on the events payload (above) — the real blocker for B on that
  read.
- Consumer audit may show payload IS needed inline → A is off the table, B/caching only.
- C transfer cost must be measured before building.
