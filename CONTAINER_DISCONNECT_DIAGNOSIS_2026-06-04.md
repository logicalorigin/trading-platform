# Container Disconnect Diagnosis — 2026-06-04

## Question

Why did the Replit project container disconnect at ~19:08 UTC on 2026-06-04,
and can a codex agent running in the terminal be ruled out as the cause?

## Verdict (short)

- The container was **definitively replaced** (full microVM swap), not merely
  the app workflow restarting.
- There is **no recorded codex *action*** that triggered it, and **no watched
  config file was edited** anywhere near the event.
- The replacement **mechanism** (boot-id change, new DB token, pid1 version bump)
  is host/control-plane only — no in-guest process can perform it.
- I **cannot certify codex contributed zero memory pressure**, because the
  container ran hot (~2.9GB API RSS vs 1.5GB threshold) into the swap and the
  host-side trigger reason is not visible from inside the guest.

## Evidence

### 1. A full container replacement occurred (guest-provable)

Flight recorder `.pyrus-runtime/flight-recorder/incidents.jsonl`, incident at
`2026-06-04T19:08:32.516Z`, classification `container-replaced`:

- Boot ID changed: `btime:1780577682` (up since 12:54:42 UTC) -> `btime:1780599510`.
- New Replit DB token issued at `2026-06-04T19:08:02Z` (prior token was not due
  to expire until 2026-06-07).
- `REPLIT_PID1_VERSION` bumped `0.0.259 -> 0.0.260` (host init binary upgraded).

No process inside the container (codex, a shell command, or the app) has the
privilege to replace a microVM or change the host pid1 version. That mechanism
was executed by Replit's control plane.

### 2. No config edit fired near the event (rules out the documented bounce path)

Watched-file mtimes at time of investigation:

- `.replit` — `2026-06-04 16:09 UTC` (~3h before the swap)
- `replit.nix` — `2026-05-26`
- `artifacts/pyrus/.replit-artifact/artifact.toml` — `2026-05-25`

The primary way a terminal agent could trigger a workspace bounce (editing a
watched config file) did not happen.

### 3. No codex action precedes the event

`pnpm run diagnose:agent-restarts` correlator found codex activity only at:

- `2026-06-04T19:11:14Z`
- `2026-06-04T19:11:34Z`
- `2026-06-04T19:12:34Z`

All are **2.5–4 minutes after** the 19:08:32 swap, and all are read/grep
operations on `SESSION_HANDOFF` files (exit 0). The `resource-risk` /
`workflow-risk` tags are the tool's conservative categorization of command
types, not evidence of impact, and they post-date the event regardless.

### 4. Sustained memory pressure into the swap (the honest gap)

`api-memory-pressure` events (`.pyrus-runtime/flight-recorder/api-events-2026-06-04.jsonl`),
threshold `1610612736` bytes (1.5GB):

| Time (UTC)            | API RSS (bytes) | ~GB  |
|-----------------------|-----------------|------|
| 18:43:17              | 3,141,718,016   | 3.14 |
| 19:00:14              | 2,816,589,824   | 2.82 |
| 19:04:16              | 2,916,167,680   | 2.92 |
| 19:06:20              | 2,915,205,120   | 2.92 |
| 19:07:27 (last before)| 2,897,387,520   | 2.90 |
| 19:12:43 (post-swap)  | 1,613,848,576   | 1.61 |

268 memory-pressure events were recorded on 2026-06-04. The microVM has one
shared memory budget across the API, Vite, shells, and any codex agent in the
terminal. A replacement landing on a newer host image (pid1 0.0.260) is
consistent with **both** a planned platform rollout **and** a resource-pressure
eviction that rebuilt onto the latest host.

## What can and cannot be proven

**Proven:**

- A full container/microVM replacement happened.
- No codex *action* (config edit, workflow restart, command) precedes it; nearest
  codex activity is +2.5 min.
- The replacement mechanism is host-only and cannot be performed from inside the
  guest.

**Not provable from inside the guest:**

- The host-side trigger reason (planned upgrade vs resource eviction).
- That codex (or any terminal process) contributed exactly zero to the
  container's total memory footprint, since per-process history for terminal
  processes is not retained and the host trigger is not exposed.

## The finding that actually matters

The API holds **~2.9GB RSS while its JS heap is only 0.5–0.9GB and external is
~0.02GB** — a ~2GB non-heap RSS gap (glibc/V8 memory not returned to the OS, or
native allocation/fragmentation).

This is significant because the merged memory work prunes **JS-heap caches**,
which cannot reclaim a ~2GB **non-heap** gap. RSS remaining at ~2.9GB after that
work confirms cache pruning was not the lever for the bulk of this footprint.

The eviction-proneness here is therefore driven by non-heap RSS that cache
pruning does not touch, and warrants a dedicated investigation rather than
another cache adjustment.

## Recommended next step

Investigate why API RSS holds ~2GB of non-heap memory (native/fragmentation),
independent of the JS-heap cache pruning already merged. This is a different
investigation than the cache-eviction work and is the highest-leverage path to
reducing container eviction risk.
