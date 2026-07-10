# WO-RESTART-FORENSICS — explain the abrupt supervisor tree-kills (task #7)

Dispatched by Claude session 26888663 (2026-07-09 ~13:40 MDT), Riley-approved. Worker: codex sol.
Report to: `.codex-watch/wo-restart-forensics-report.md`. STRICTLY READ-ONLY: no file edits (except
the report), no process signals, no restarts. Propose instrumentation; do not install it.

Context: the dev workflow supervisor tree was killed abruptly (previous run classified "live"/
heartbeat-fresh, no shutdown events, pid2 respawns ~10s later) NINE times 14:00:03Z→15:02:48Z and
again at 18:31:47Z today. System memory was healthy before kills (5-6GB available); cgroup oom_kill
counters were 0; kill mechanism UNVERIFIED. Prior notes: instability appendix in
docs/plans/signal-monitor-gc-pool-rootcause-2026-07-09.md (candidates: platform resource-killer on
CPU/mem spikes, cgroup pid/memory ceilings, untracked supervisor takeover; the 14:35:58Z kill was 2s
after a SIGUSR2 in-place reload which triggers an in-supervisor pnpm build). AGENTS.md commit
bab66419 retired the REPLIT_MODE=workflow shell-restart (the earlier kill-storm mechanism) — verify
nothing still uses it.

## Deliverables
1. **Kill timeline.** Parse /tmp/pyrus/pyrus-dev-lifecycle-8080.jsonl +
   .pyrus-runtime/flight-recorder/incidents.jsonl + supervisor heartbeats: for EVERY abrupt kill today
   list kill time, last heartbeat gap, phase, child RSS, systemMemory available/free, cgroup pids
   (heartbeats carry systemMemoryMb; supervisorCurrent carries cgroup) — and what was happening in the
   60s before (SIGUSR2 reload builds? spikes in child RSS? pid counts near 1024?).
2. **Mechanism elimination.** For each candidate — (a) cgroup pids ceiling, (b) cgroup/system memory,
   (c) pid2 policy restart (user Run click indistinguishable?), (d) SIGUSR2-build CPU spike triggering
   a platform killer, (e) rogue shell-launched supervisor takeover (lock steals), (f) leftover
   REPLIT_MODE=workflow usage anywhere in repo scripts/docs — state evidence FOR/AGAINST from the
   timeline. Rank surviving hypotheses. It is acceptable (expected) that the final answer may be
   "unknowable from inside the container"; say precisely what external evidence (Replit console
   history, platform logs) would settle it.
3. **Instrumentation proposal.** Design (do not install) a minimal watchdog: what to sample (process
   count, cgroup pids/memory current, per-child RSS, build-in-progress flag), where to write, and what
   pattern in its output would discriminate the surviving hypotheses at the next kill. Smallest
   correct thing; it must add ~zero load.

## Report format
Timeline table, per-hypothesis evidence, ranked verdict (label unverified clearly), instrumentation
spec. End with a 10-line executive summary.
