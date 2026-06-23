# Investigation: Replit terminals freeze/lag after a few minutes (dev VM memory oversubscription)

Date: 2026-06-22. Status: **diagnosed** (fix proposed, not yet applied).

## Symptom
After the app runs for a few minutes, the Replit terminals (Claude + other agents) freeze and lag.

## Root cause: VM memory oversubscription (NOT an app heap leak)
The 16 GB dev VM runs out of RAM. It is not one runaway process and not a classic leak — multiple uncapped Node processes plus the agent terminals collectively exceed 16 GB.

### Evidence
- **VM:** `free -m` → used **15441 / 15985 MB (~96%)**, available **~543 MB and falling** (543 → 229 in 15s during sampling), **swap 0**. With no swap, near-full RAM starves every process, including the terminals.
- **API server is the dynamic hog:** `node ./dist/index.mjs` RSS **1.7 GB → 2.5 GB in ~80s**, then **pins ~2.3–2.5 GB** (high-water mark; V8 does not return freed pages to the OS).
- **It is NOT a heap leak:** the API's JS heap GCs fine — `heapUsed` observed **1298 → 1970 → 951 MB** (a GC reclaimed it). The garbage collector is working; the heap is healthy.
- **It is NOT an SSE/connection leak:** `requests.longLivedRequestCount` was steady at **1** across the window (the 477 seen earlier was a transient burst, not accumulation).
- **It is NOT disk:** `.pyrus-runtime/flight-recorder` 221 MB, `/tmp` 55 MB.
- **No per-process heap cap:** none of the app Node processes (`dist/index.mjs`, `vite.js`, `run-market-data-worker.mjs`, `runDevApp.mjs`) pass `--max-old-space-size`, so each **auto-sizes its V8 old-space to ~4288 MB** (sized to the 16 GB VM). With 4+ app Node processes, collective potential heap ≫ 16 GB.
- **Other tenants on the same VM:** ~5 `claude` agent processes (~500 MB each ≈ 2.5 GB) + `codex` (~170 MB), plus Vite (~0.6 GB) and the worker.

### Why "builds up over a few minutes"
A fresh API process starts small and **ratchets its working set up to ~2.5 GB** as load/caches warm, and RSS never shrinks back. Once that plus the agents plus Vite/worker plus buff/cache crosses 16 GB, the VM thrashes and terminals freeze.

## Fix (proposed, dev-only)
Cap each app Node process's heap so none can balloon to ~4.3 GB on the shared VM:
- API (`dist/index.mjs`): `--max-old-space-size=2560` (working set peaks ~2 GB; forces earlier GC and caps RSS with headroom).
- market-data worker: `--max-old-space-size=1024`.
- Vite: `--max-old-space-size=1536`.

Bounds the app to ~5 GB instead of a potential 12 GB+, leaving room for agent terminals. Set in the **dev startup only** so production (where the API runs alone) is unaffected. `MALLOC_ARENA_MAX=2` is already set in the dev startup (glibc fragmentation is already controlled); this addresses the V8 side.

⚠️ Implementing touches the artifact dev startup → run `pnpm run audit:replit-startup` per the repo run rules.

## Secondary levers
- Close idle agent sessions (~500 MB freed each).
- The `/signal-monitor/state` short-TTL cache shipped on main (`f5d8b77`) already trims the API's peak transient allocations (fewer concurrent 1.4 MB state parses/serializations).
- Reducing concurrent DB demand (the broader pressure work) lowers the API's peak working set too.

## Files referenced
- Dev startup / spawn: `scripts/runDevApp.mjs`, artifact dev scripts (`artifacts/*/.replit-artifact/artifact.toml`).
- Heap/process: `dist/index.mjs` (API), `vite.js` (web), `run-market-data-worker.mjs` (worker).
- Live signals: `.pyrus-runtime/flight-recorder/api-current.json` (`memoryMb`, `requests.longLivedRequestCount`).
