---
name: Replit reconnect/restart diagnosis
description: How to triage recurring PYRUS workspace/container reconnects and what each signal does and does not prove.
---

# Diagnosing PYRUS workspace/container reconnects

Start with `pnpm run diagnose:agent-restarts` (observe-only). Evidence lives in
`.pyrus-runtime/flight-recorder/incidents.jsonl` and `api-events-*.jsonl`, plus
`/tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl`.

## What each signal proves
- **DB-token reissue (JWT in `REPLIT_DB_URL`)** — a *symptom* of container
  replacement, never a cause. Tokens are uniform ~80h TTL; `iat` changes ONLY on
  `container-replaced` and is reused unchanged across same-container bounces.
  Reissue happens far before expiry → not expiry-driven. `flightRecorder.mjs`
  decodes it via `readReplitDbTokenClaims`/`decodeJwtPayload`.
- **`container-replaced` vs same-container bounce** — `incidents.jsonl`
  classifies via `btime` change. A pid1 version bump means a rollout; no pid1
  bump = a plain recycle. Both are host-decided; the *reason* is not exposed to
  the guest.
- **Codex agent activity** — a container swap rotates the agent's log DB
  (`~/.codex/logs_*.sqlite`) and can prune the pre-crash rollout, so the guest
  may retain NO live record of an agent's pre-crash tool calls. Reconstruct from
  the `SESSION_HANDOFF_*.md` doc + `git status` (dirty files) instead.

## Triage rule
1. Check whether any watched control-plane file is dirty (`.replit`,
   `*/.replit-artifact/artifact.toml`, `replit.nix`). If clean, the agent's code
   work did NOT trigger the reload.
2. The documented guest-side trigger is a **Replit env/secret write** (set/delete
   env var, add secret) — it rewrites `/run/replit/env/latest.json` +
   `toolchain.json` and, in `PNPM_WORKSPACE` stack mode, bounces the supervisor
   ~1s later. Correlate reconnect timestamps against env/secret changes.
3. OOM is usually falsifiable fast: check peak RSS vs limit, `oom_kill` counter,
   and PSI. Do not assume memory pressure without these.

**Why:** repeated investigations chased token expiry and OOM theories that the
evidence falsifies. The terminal cause of a recycle is a host boundary; be
explicit about what is proven (what/when changed in the guest) vs unknowable
(the host scheduler's reason). Do not add Replit workflows, local Postgres
startup, or root runners to "fix" this class of incident.
