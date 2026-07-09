# WO-R5 bar_cache Drain Report

Worker: wo-r5  
Started: 2026-07-09T00:50Z  
Stopped: 2026-07-09T01:47:38Z  
Outcome: stopped before completion because `/api/healthz` failed to connect. The work-order hard stop was honored; no further deletes, vacuum, or post-drain probe were run after the health failure.

## Policy Used

Observed in `lib/db/src/retention.ts`:

- Daily+ timeframes: `1d`, `1w`, `1M`, `1mo`
- Intraday policy: `timeframe NOT IN ('1d','1w','1M','1mo') AND starts_at < now() - interval '60 days'`
- Daily+ policy: `timeframe IN ('1d','1w','1M','1mo') AND starts_at < now() - interval '400 days'`

`bar_cache` has an `id` primary key, so deletes used the `id IN (SELECT id FROM doomed)` form.

## Baseline

- `pg_total_relation_size('bar_cache')`: `8038 MB`
- Intraday bounded deletable probe, `LIMIT 100000`: `100000`
- Daily+ bounded deletable probe, `LIMIT 100000`: `1098`

## Drain Result Before Hard Stop

- Intraday rows deleted: `208750`
- Daily+ rows deleted: `1098`
- Intraday successful delete batches: `78`
- Daily+ successful delete batches: `1`
- Intraday timeout attempts: `9`
- Daily+ timeout attempts: `0`
- Pressure pauses: `5`
- Final successful intraday batch: batch `78`, `2500` rows, cumulative `208750`
- Stop condition: `curl -fsS http://127.0.0.1:8080/api/healthz` failed to connect at `2026-07-09T01:47:38Z`
- Per-batch log: `.codex-watch/wo-r5-drain.log`

Batch sizing notes:

- `50000` timed out once.
- `25000` timed out once.
- `10000` had one success, then one timeout.
- `5000` had successes, then timed out.
- `2500` was the last stable batch size, with isolated timeouts and required pressure pauses.

## Size After Stop

- `pg_total_relation_size('bar_cache')` after the partial drain: `8048 MB`
- Intraday remaining bounded probe, `LIMIT 100000`: timed out at `15s`
- Daily+ remaining bounded probe, `LIMIT 100000`: `214`

The relation size did not shrink because vacuum was not reached; dead tuples remain until vacuum can run.

## Vacuum

Not run. The work order says to stop draining and report if `/api/healthz` is unhealthy; the zero-row completion condition was not reached.

## Post-Drain Probe

Not run. The drain did not complete and the API health hard stop fired before the post-drain verification phase. No `artifacts/api-server/src/services/__probe-5m.mts` file was created.

| Timeframe | Pre Baseline | Post |
| --- | ---: | --- |
| `1m` | `183ms` | not run |
| `5m` | `16357ms + 57014` | not run |
| `15m` | `208ms` | not run |
