# WO-14: Missed-trades post-mortem — 2026-07-07 RTH (READ-ONLY)

You are `codex-worker` for `claude-lead` (session f68a9158). Repo `/home/runner/workspace`. INVESTIGATION ONLY — no code changes, no commits, no restarts. Do NOT read `~/.claude/`, `.claude/skills/`, `agents/`. Read-only DB via `cd lib/db && node -e` with pg + `$DATABASE_URL`; ALWAYS `set statement_timeout='12s'` and use indexed predicates (`occurred_at` ranges, partial-indexed event types) — the pool is distressed.

## Established facts (claude-lead, 20:04-20:10Z)

- Today (Jul 7) RTH shadow entries: **3** (vs 10 on Jul 6). Exits: 7.
- `signal_options_seen_signals` today: 57 rows total — hourly: 13h:17, **14h:0**, 15h:9, 16h:6, 17h:2, 18h:1, 19h:19 (UTC). Reasons: mtf_not_aligned **48**, no_expiration_in_dte_window 3, after_hours 1, same_direction_position_open 1, missing_bid_ask 1.
- `execution_events` today: signal_options_candidate_skipped **125**, candidate_created 23, shadow_entry 3.
- Runtime at 20:03Z: pressureLevel high; ELU 98%; DB ping 7746ms; `automation.failure_count` tripping (diagnostics.ts:432/2429); `signal_options_scan_stale`; `persist_signal_monitor_matrix_states` failing with a giant IN() select on signal_monitor_events (signalMonitor.lastDbFallback 20:01:10Z, non-transient); API process restarted ~19:53Z.
- Scanner: 755-symbol horizon, batchSize 4, interval 15s → estimatedCycleMs 2,835,000 (47min).

## Questions to answer (each with evidence: query results, file:line, timestamps)

1. **Upstream denominator:** how many raw buy/sell signals did the signal monitor emit today during RTH (`signal_monitor_events`, indexed columns — check schema `lib/db/src/schema/signal-monitor.ts:106` for columns; bucket hourly)? Compare to the 57 evaluated → quantify the never-evaluated gap per hour.
2. **The dead hours:** why did evaluations drop to 0 at 14:00Z and ~0 at 17-18h? Correlate with: flight-recorder api events (`.pyrus-runtime/flight-recorder/api-events-*.jsonl`, events around 14:00Z and 17-19h), pressure snapshots if persisted, API restarts/reloads (was there a reload/crash?), and `automation.failure_count` source events (what feeds failureCount in `diagnostics.ts` ~2429 — find the failure events and count them today by hour).
3. **Candidate funnel:** histogram `signal_options_candidate_skipped` payload reasons today (payload jsonb has a reason/skip field — inspect one row first, then aggregate with `payload->>'reason'` style; LIMIT sampling if aggregate too slow).
4. **MTF gate provenance:** what did the Jul 2 decision resolve? Read `SESSION_HANDOFF_2026-07-02_6329348a-*.md` and `SESSION_HANDOFF_2026-07-02_f7ca877c-*.md` (repo root) + `rg -n 'mtf|unanimity' artifacts/api-server/src/services/signal-options-automation.ts | head` to cite the current gate code and its config. Is unanimity-across-timeframes the user's confirmed intent, and is there a config knob?
5. **Was the drought pressure-gating or absence of signals?** Check whether automation evaluation is explicitly gated at watch/high pressure (rg pressure-level consumers in signal-options-automation.ts / platform.ts automation gating) and whether those gates were active in the dead hours.

## Deliverable

`.codex-watch/wo-14-missed-trades-postmortem-2026-07-07.md`: the funnel table (raw signals → evaluated → passed gates → candidates → entries, hourly), the verified cause of each dead hour (or "cause unverified" + the check that would confirm), the MTF-gate provenance verdict, the candidate-skip histogram, and a ranked list of what would have recovered the most trades today (policy change vs pressure fix vs bug fix) — clearly separating verified causes from hypotheses.
