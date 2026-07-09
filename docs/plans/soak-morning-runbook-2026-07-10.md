# Morning runbook — 2026-07-10 soak readback + open acceptance

Owner: whichever session picks up in the morning (context: session e2aac502 staged this on 2026-07-09 evening; Riley approved both shadow soaks and the fix program).

## Pre-open (by ~07:15 MDT)

1. **Verify both shadow flags are live in the API process env** (the ~00:17Z microVM rotation
   should have injected them from `.replit [userenv.development]`):
   ```
   APIPID=$(python3 -c "import json;print(json.load(open('.pyrus-runtime/flight-recorder/api-current.json'))['pid'])")
   tr '\0' '\n' < /proc/$APIPID/environ | grep -E "INCREMENTAL_EVAL|STORED_BARS_DELTA"
   ```
   Expect `PYRUS_SIGNALS_INCREMENTAL_EVAL=shadow` and `PYRUS_SIGNALS_STORED_BARS_DELTA=shadow`.
   If missing: `kill -USR2 "$(pgrep -f 'node ./scripts/runDevApp.mjs' | head -1)"` (supervisor cwd is
   `artifacts/pyrus/`), poll healthz 200, re-check env.
2. **Confirm the counters are visible** (both live under marketDataStreams in
   `GET /api/diagnostics/runtime`): `signalMonitorIncrementalEval.mode == "shadow"` and
   `signalMonitorLocalBars.storedBarsDelta.mode == "shadow"` (field name per WO-F1-DELTA).
3. Note bar_cache index sizes post-REINDEX (see tail of `.codex-watch/run-vacuum.log`).

## At open (~07:30 MDT)

4. Run the acceptance capture: `node scripts/diag/market-open-acceptance.mjs` (WO-OPEN-ACCEPT,
   commit a5d1162b). Targets vs 2026-07-09 baselines: GC <10% of busy, _parseRowAsArray <15% of
   allocation, busy <80%, old_space <1100MB, interactive admission p95 wait <250ms
   (now readable via `dbPoolAdmission.lanes` in runtime diagnostics), zero shed.
5. BUS-3B re-measure gate: count signal-monitor symbol-state upserts/min at open; dispatch
   wo-bus-3b only if >=300/min (first dispatch was killed at 8/min).

## During RTH (spot-check ~09:00 and ~12:00 MDT)

6. Soak counters readback:
   - `signalMonitorIncrementalEval`: expect `appends >> seeds`, `shadowChecks > 0`, and
     **`shadowMismatches == 0`**. Any mismatch = do NOT flip; capture the mismatch log lines.
   - `storedBarsDelta`: expect `deltaReads`/`appliedAppends` climbing, `gapFallbacks` small,
     **`shadowMismatches == 0`**.

## End of session — Riley decisions (with numbers in hand)

7. `PYRUS_SIGNALS_INCREMENTAL_EVAL` shadow→on (runbook: needs full-RTH soak, mismatches=0, Riley ok).
8. `PYRUS_SIGNALS_STORED_BARS_DELTA` shadow→on (same criteria).
9. WO-IDX-1 (pkey drop + index consolidation): proceed only per the investigation verdicts in the
   2026-07-09 session record; the code retarget is unblocked (market-data-store.ts committed) but
   was deliberately held out of the soak window.

## Still queued from 2026-07-09

- EQH-1 (equity-history bucket-first reads) — was blocked on a sibling session's shadow-account.ts
  WIP; check `git status --short -- artifacts/api-server/src/services/shadow-account.ts` and
  dispatch `docs/plans/workorders-2026-07-09/wo-eqh-1-bucket-first-reads.md` when clean.
- Authenticated algo/chart Playwright specs (storage state in the 2026-07-09 session scratchpad
  dies with rotation — mint a fresh one: insert into auth_sessions per the pattern in memory
  `replit-container-agent-quirks`, Riley-approved).
- Remaining un-adjudicated QA findings beyond the top-12 pass (see
  `.codex-watch/qa-campaign-2026-07-09/` adjudication results).
- Push: local main is ~40+ commits ahead; container git auth is broken — Riley pushes.
