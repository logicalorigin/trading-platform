-- Deployment phase 2: apply only after the source_kind writer is deployed and
-- every old writer has drained. Applying this classifier earlier lets an old
-- conflict update replace event_id while retaining a stale historical label.
--
-- The predicate intentionally mirrors signalOptionsHistoricalLifecycleEventSql.
-- Reclassify every row still linked to its deployment's source event: an old
-- writer can replace event_id while retaining either stale non-unknown label.
-- Pruned and originally-unpersisted source events remain unknown, and a
-- cross-deployment event link remains untouched.
-- New writers maintain event_id and source_kind in the same conflict update;
-- the final event_id fence yields if one changes the link before this update
-- wins the row lock, preserving that writer's already-consistent pair.
WITH classified AS (
  SELECT sidecar."id" AS sidecar_id,
    sidecar."event_id" AS event_id,
    CASE
      WHEN coalesce(
        (
          jsonb_typeof(event."payload"->'backfillEventKey') = 'string'
          AND btrim(
            event."payload"->>'backfillEventKey',
            U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
          ) <> ''
        )
        OR btrim(
          event."payload"->'metadata'->>'runSource',
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        ) IN ('signal_options_backfill', 'signal_options_replay')
        OR btrim(
          event."payload"->'metadata'->>'sourceType',
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        ) IN ('signal_options_backfill', 'signal_options_replay')
        OR event."payload"->'metadata'->>'runMode'
          IN ('historical_backfill', 'replay')
        OR btrim(
          event."payload"->'backfill'->>'source',
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        ) IN ('signal_options_backfill', 'signal_options_replay')
        OR btrim(
          event."payload"->'replay'->>'source',
          U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
        ) IN ('signal_options_backfill', 'signal_options_replay'),
        false
      ) THEN 'historical'
      ELSE 'live'
    END AS source_kind
  FROM "signal_options_seen_signals" AS sidecar
  JOIN "execution_events" AS event
    ON event."id" = sidecar."event_id"
    AND event."deployment_id" = sidecar."deployment_id"
)
UPDATE "signal_options_seen_signals" AS sidecar
SET "source_kind" = classified.source_kind
FROM classified
WHERE classified.sidecar_id = sidecar."id"
  AND sidecar."event_id" IS NOT DISTINCT FROM classified.event_id
  AND sidecar."source_kind" IS DISTINCT FROM classified.source_kind;
