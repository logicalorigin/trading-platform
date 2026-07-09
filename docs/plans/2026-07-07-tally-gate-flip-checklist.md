# Signal-Options Running-Tally Gate-Flip Checklist

Generated for WO-SO-04 on 2026-07-08. This is a readiness checklist for flipping
`SIGNAL_OPTIONS_TALLY` from `shadow` to `on`. The shadow ledger remains the sole
source of truth; the in-memory tally is a cache. No new tables are part of this
procedure.

## Current Snapshot

Observed at 2026-07-08T01:04:09Z:

- `SIGNAL_OPTIONS_TALLY=shadow` in `.pyrus-runtime/dev-env.local`.
- Runtime route: `http://127.0.0.1:8080/api/diagnostics/runtime`.
- Runtime tally diagnostics: `mode=shadow`, `projections=1`, `drift=0`,
  `dedupDrift=0`, `pnlDrift=0`, `controlDrift=0`, `compares=6`, `rebuilds=0`.
- `.pyrus-runtime/flight-recorder/api-current.json`: `pid=33336`,
  `updatedAt=2026-07-08T01:04:06.887Z`, `uptimeMs=417925`, derived process start
  `2026-07-08T00:57:08.962Z`.
- Inferred bake time since the latest process reset at the HTTP sample:
  about 7m00s.
- Unknown: `lastFullRebuildReason`. The current diagnostics export does not
  include a last-rebuild reason field; source exports only mode, projection count,
  drift counters, compare count, and rebuild count.

## Preconditions

| Gate | Verification command or route | Current status | Notes |
|---|---|---:|---|
| Tally flag is still in shadow before bake evaluation | `sed -n '/^SIGNAL_OPTIONS_TALLY=/p' .pyrus-runtime/dev-env.local` | PASS | Observed `SIGNAL_OPTIONS_TALLY=shadow`. |
| Live process reports shadow mode and observable counters | `curl -fsS --max-time 15 'http://127.0.0.1:8080/api/diagnostics/runtime'` and read `.signalOptionsTally` | PASS | Observed mode `shadow`, all drift counters zero, `compares=6`, `rebuilds=0`. |
| Process-age evidence is recorded for every counter window | `node -e "const fs=require('fs'); const j=JSON.parse(fs.readFileSync('.pyrus-runtime/flight-recorder/api-current.json','utf8')); console.log(j.updatedAt,j.pid,j.uptimeMs)"` | PASS for first snapshot | Current process window is only about 7 minutes old; this does not satisfy bake duration. |
| Zero REAL drift across >=28 VM-rotation windows | Snapshot procedure below, one pre-rotation and one post-rotation snapshot for each expected 6h VM rotation | FAIL | Recommended N=28 because T17 says >=1 week and rotations are about every 6h. Current evidence covers less than one rotation. |
| Comparator seeding fixed, or any restart drift is explicitly classifiable | Source check: `nl -ba artifacts/api-server/src/services/signal-options-automation.ts | sed -n '7484,7504p'` | PASS | Fix C is implemented as lazy cold-projection seeding: full ledger read seeds recent entry-candidate skips before the first shadow comparator. |
| No unexplained tally/ledger divergence in shadow comparator | Runtime route above plus warn-log review if any counter increments | PASS for current window | Current counters are zero. Any future non-zero counter must be classified against the drift table in the WO report before counting as benign. |
| Last full-rebuild reason visible in diagnostics | `curl -fsS --max-time 15 'http://127.0.0.1:8080/api/diagnostics/runtime'` and inspect `.signalOptionsTally` keys | UNKNOWN | Current source does not export this field. Use `rebuilds` plus process age until observability is extended. |
| All signal-options suites are green | `cd artifacts/api-server && node --import tsx --test $(find src/services -maxdepth 1 -name 'signal-options*.test.ts' -print | sort)` | UNKNOWN | Not run by WO-SO-04. Must be run by the gate owner before flip. |
| API typecheck is green | `pnpm --filter @workspace/api-server run typecheck` | UNKNOWN | Not run by WO-SO-04. Required before flip. |
| Live-money Checkpoint 0 is green | Run the T1-T3 targeted tests and `pnpm --filter @workspace/api-server run typecheck` | UNKNOWN | The live-money plan requires the surgical money-path fixes and typecheck before trusting later gates. |
| Live-money Checkpoint 1 is green | Runtime route above plus snapshot trail: shadow mode, drift observable, zero REAL drift | FAIL | Shadow mode is live and observable, but the bake trail is too short. |
| Live-money Checkpoint 2 is green | Run the T9-T12 money-path test suites named in the live-money plan | UNKNOWN | Not verified by WO-SO-04. |
| No source/control-plane drift during the bake window | Record `git rev-parse HEAD`, `git status --short`, and snapshot timestamps with every sample | UNKNOWN | Worktree is dirty from other lanes. Gate owner must decide which committed SHA and dirty state are inside the bake. |

## Snapshot Procedure

Store snapshots under `.codex-watch/tally-snapshots/`. No database table is needed.

Recommended cadence:

- Every hour while the bake is active.
- At 00:10, 06:10, 12:10, and 18:10 UTC, before the expected Replit rotation
  around `:17`.
- At 00:25, 06:25, 12:25, and 18:25 UTC, after the expected rotation, to prove
  the new process age and reset baseline.
- Immediately before any planned reload, and again immediately after reload.

A rotation window counts toward the >=28-window gate only when there is a
pre-rotation snapshot with zero REAL drift and a post-rotation snapshot proving
the new process start and zero fresh drift.

Use this command shape:

```bash
mkdir -p .codex-watch/tally-snapshots
SNAPSHOT_TS="$(date -u +%Y-%m-%dT%H%M%SZ)"
SNAPSHOT_FILE=".codex-watch/tally-snapshots/${SNAPSHOT_TS}.md"
{
  echo "# Tally Snapshot ${SNAPSHOT_TS}"
  echo
  echo "## Env"
  sed -n '/^SIGNAL_OPTIONS_TALLY=/p' .pyrus-runtime/dev-env.local
  echo
  echo "## Runtime Diagnostics"
  curl -fsS --max-time 15 'http://127.0.0.1:8080/api/diagnostics/runtime' \
    | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify({sampledAt:new Date().toISOString(), timestamp:j.timestamp, api:{uptimeMs:j.api&&j.api.uptimeMs}, signalOptionsTally:j.signalOptionsTally}, null, 2));})"
  echo
  echo "## Flight Recorder"
  node - <<'NODE'
const fs = require('fs');
const p = '.pyrus-runtime/flight-recorder/api-current.json';
const st = fs.statSync(p);
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
const updated = j.updatedAt ? new Date(j.updatedAt) : st.mtime;
const start = typeof j.uptimeMs === 'number'
  ? new Date(updated.getTime() - j.uptimeMs)
  : null;
console.log(JSON.stringify({
  path: p,
  fileMtime: st.mtime.toISOString(),
  updatedAt: j.updatedAt,
  pid: j.pid,
  ppid: j.ppid,
  uptimeMs: j.uptimeMs,
  derivedProcessStartAt: start && start.toISOString(),
  topKeys: Object.keys(j)
}, null, 2));
NODE
} > "$SNAPSHOT_FILE"
printf '%s\n' "$SNAPSHOT_FILE"
```

## Flip Procedure

Only `claude-lead` performs the reload. WO-SO-04 does not send signals.

1. Confirm all preconditions above are PASS, except intentionally accepted
   UNKNOWNs that are documented and owner-approved.
2. Change `.pyrus-runtime/dev-env.local` from:

```bash
SIGNAL_OPTIONS_TALLY=shadow
```

to:

```bash
SIGNAL_OPTIONS_TALLY=on
```

3. `claude-lead` reloads the pid2-owned PYRUS supervisor with the sanctioned
   SIGUSR2 reload path. Do not start a separate supervisor.
4. Confirm the process picked up the flag:

```bash
curl -fsS --max-time 15 'http://127.0.0.1:8080/api/diagnostics/runtime' \
  | node -e "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>{const j=JSON.parse(s); console.log(JSON.stringify(j.signalOptionsTally,null,2));})"
```

Expected: `mode=on`, `drift=0`, `rebuilds=0`.

## First-Hour Watch

For the first hour after flip, take snapshots every 5 minutes and inspect:

- `signalOptionsTally.mode` remains `on`.
- `drift` remains `0`.
- `rebuilds` remains `0`; in authoritative mode a rebuild means drift self-repair.
- Any `dedupDrift`, `pnlDrift`, or `controlDrift` that appears after returning
  to `shadow` is classified before proceeding.
- API health remains reachable through the normal health/readiness surfaces.
- No signal-options tally drift warnings are present in the current runtime logs.

## Rollback Criteria

Flip back to `shadow` immediately if any of these occur:

- `drift > 0` or `rebuilds > 0` while `mode=on`.
- Any shadow comparator drift that cannot be classified as BENIGN-EXPECTED with
  timestamped evidence.
- Position count, symbol, quantity, stop, peak, or mark divergence in the
  comparator.
- Daily P&L or control-updated-at divergence with no source-confirmed shape
  transition explanation.
- Signal-options scans start failing or the route cannot report tally diagnostics.

Rollback procedure:

1. Change `.pyrus-runtime/dev-env.local` back to `SIGNAL_OPTIONS_TALLY=shadow`.
2. `claude-lead` performs the sanctioned SIGUSR2 reload.
3. Confirm `mode=shadow` through `/api/diagnostics/runtime`.
4. Take an immediate rollback snapshot and keep the bake in shadow until the
   counter source is classified and fixed.
