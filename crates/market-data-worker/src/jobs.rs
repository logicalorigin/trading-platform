use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use serde_json::{json, Value};
use sqlx::{FromRow, PgPool, Postgres, Transaction};

use crate::config::WorkerConfig;

#[derive(Debug, Clone, FromRow)]
pub struct IngestJob {
    pub id: String,
    pub kind: String,
    pub symbol: String,
    pub lease_owner: String,
    pub attempt_count: i32,
    pub max_attempts: i32,
    #[allow(dead_code)]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OptionChainGeneration {
    pub as_of: DateTime<Utc>,
    pub option_count: usize,
}

fn option_chain_generation_receipt(as_of: DateTime<Utc>, option_count: usize) -> Result<Value> {
    let option_count = i64::try_from(option_count)
        .map_err(|_| anyhow!("option-chain generation count is too large"))?;
    Ok(json!({
        "optionChainAsOf": as_of.to_rfc3339(),
        "optionChainCount": option_count,
    }))
}

fn parse_option_chain_generation(payload: &Value) -> Result<OptionChainGeneration> {
    let as_of = payload
        .get("optionChainAsOf")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("completed option-chain job has no generation timestamp"))?;
    let as_of = DateTime::parse_from_rfc3339(as_of)
        .map_err(|_| anyhow!("completed option-chain job has an invalid generation timestamp"))?
        .with_timezone(&Utc);
    let option_count = payload
        .get("optionChainCount")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .ok_or_else(|| anyhow!("completed option-chain job has an invalid generation count"))?;
    Ok(OptionChainGeneration {
        as_of,
        option_count,
    })
}

const CLAIM_NEXT_JOB_SQL: &str = r#"
with next_job as (
  select candidate.id
  from market_data_ingest_jobs candidate
  where (
    (
      candidate.status = 'queued'
      and (candidate.next_run_at is null or candidate.next_run_at <= now())
    )
    or (
      candidate.status = 'running'
      and candidate.lease_expires_at < now()
      and candidate.attempt_count < candidate.max_attempts
    )
  )
    and (
      candidate.kind <> 'gex_snapshot'
      or coalesce(candidate.payload->>'dedupeBucket', '') = ''
      or (
        exists (
          select 1
          from market_data_ingest_jobs prerequisite
          where prerequisite.symbol = candidate.symbol
            and prerequisite.kind = 'option_chain_snapshot'
            and prerequisite.status = 'completed'
            and coalesce(prerequisite.payload->>'dedupeBucket', '') =
              coalesce(candidate.payload->>'dedupeBucket', '')
        )
      )
    )
  order by candidate.priority asc, candidate.created_at asc
  for update skip locked
  limit 1
)
update market_data_ingest_jobs jobs
set
  status = 'running',
  lease_owner = gen_random_uuid()::text,
  lease_expires_at = now() + ($1::bigint * interval '1 millisecond'),
  last_heartbeat_at = now(),
  attempt_count = jobs.attempt_count + 1,
  updated_at = now()
where jobs.id = (select id from next_job)
returning
  jobs.id::text as id,
  jobs.kind,
  jobs.symbol,
  jobs.lease_owner,
  jobs.attempt_count,
  jobs.max_attempts,
  jobs.payload
"#;

pub async fn claim_next_job(pool: &PgPool, config: &WorkerConfig) -> Result<Option<IngestJob>> {
    let job = sqlx::query_as::<_, IngestJob>(CLAIM_NEXT_JOB_SQL)
        .bind(config.job_lease_ms)
        .fetch_optional(pool)
        .await?;
    Ok(job)
}

pub async fn lock_job_attempt_tx(
    tx: &mut Transaction<'_, Postgres>,
    job: &IngestJob,
) -> Result<()> {
    let locked_id = sqlx::query_scalar::<_, String>(
        r#"
        select id::text
        from market_data_ingest_jobs
        where id = $1::uuid
          and lease_owner = $2
          and attempt_count = $3
          and status = 'running'
          and lease_expires_at >= now()
        for update
        "#,
    )
    .bind(&job.id)
    .bind(&job.lease_owner)
    .bind(job.attempt_count)
    .fetch_optional(&mut **tx)
    .await?;
    if locked_id.is_none() {
        return Err(anyhow!(
            "market-data job lease moved before durable persistence"
        ));
    }
    Ok(())
}

const RECORD_OPTION_CHAIN_GENERATION_SQL: &str = r#"
update market_data_ingest_jobs
set
  payload = coalesce(payload, '{}'::jsonb) || $4::jsonb,
  updated_at = now()
where id = $1::uuid
  and lease_owner = $2
  and attempt_count = $3
  and status = 'running'
  and lease_expires_at >= now()
  and (payload is null or jsonb_typeof(payload) = 'object')
returning id::text
"#;

pub async fn record_option_chain_generation_tx(
    tx: &mut Transaction<'_, Postgres>,
    job: &IngestJob,
    as_of: DateTime<Utc>,
    option_count: usize,
) -> Result<()> {
    if job.kind != "option_chain_snapshot" {
        return Err(anyhow!(
            "only an option-chain job can record an option-chain generation"
        ));
    }
    // ponytail: keep the result receipt in the existing payload; add dedicated
    // immutable result columns if enqueue must preserve it instead of failing closed.
    let receipt = option_chain_generation_receipt(as_of, option_count)?;
    let updated_id = sqlx::query_scalar::<_, String>(RECORD_OPTION_CHAIN_GENERATION_SQL)
        .bind(&job.id)
        .bind(&job.lease_owner)
        .bind(job.attempt_count)
        .bind(receipt)
        .fetch_optional(&mut **tx)
        .await?;
    if updated_id.is_none() {
        return Err(anyhow!(
            "market-data job lease moved before durable persistence"
        ));
    }
    Ok(())
}

const LOCK_GEX_PREREQUISITE_SQL: &str = r#"
select coalesce(prerequisite.payload, 'null'::jsonb)
from market_data_ingest_jobs prerequisite
where prerequisite.symbol = $1
  and prerequisite.kind = 'option_chain_snapshot'
  and prerequisite.status = 'completed'
  and coalesce(prerequisite.payload->>'dedupeBucket', '') = $2
order by prerequisite.updated_at desc
limit 1
for update
"#;

fn gex_dedupe_bucket(job: &IngestJob) -> Option<String> {
    let bucket = job
        .payload
        .as_ref()
        .and_then(|payload| payload.get("dedupeBucket"))
        .map(Value::to_string)
        .unwrap_or_default()
        .trim_matches('"')
        .to_string();
    (!bucket.is_empty()).then_some(bucket)
}

pub async fn lock_gex_prerequisite_tx(
    tx: &mut Transaction<'_, Postgres>,
    job: &IngestJob,
) -> Result<Option<OptionChainGeneration>> {
    if job.kind != "gex_snapshot" {
        return Ok(None);
    }
    let Some(dedupe_bucket) = gex_dedupe_bucket(job) else {
        return Ok(None);
    };

    let prerequisite_payload = sqlx::query_scalar::<_, Value>(LOCK_GEX_PREREQUISITE_SQL)
        .bind(&job.symbol)
        .bind(dedupe_bucket)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| anyhow!("GEX prerequisite generation moved before durable persistence"))?;
    Ok(Some(parse_option_chain_generation(&prerequisite_payload)?))
}

pub async fn fail_expired_jobs_over_attempt_limit(pool: &PgPool) -> Result<u64> {
    let result = sqlx::query(
        r#"
        update market_data_ingest_jobs
        set
          status = 'failed',
          lease_owner = null,
          lease_expires_at = null,
          last_error = concat(
            'job lease expired after ',
            attempt_count,
            ' attempts'
          ),
          updated_at = now()
        where status = 'running'
          and lease_expires_at < now()
          and attempt_count >= max_attempts
        "#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

const HEARTBEAT_JOB_SQL: &str = r#"
update market_data_ingest_jobs
set
  lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
  last_heartbeat_at = now(),
  updated_at = now()
where id = $1::uuid
  and lease_owner = $2
  and status = 'running'
  and attempt_count = $4
  and lease_expires_at >= now()
"#;

pub async fn heartbeat_job(pool: &PgPool, job: &IngestJob, lease_ms: i64) -> Result<bool> {
    let result = sqlx::query(HEARTBEAT_JOB_SQL)
        .bind(&job.id)
        .bind(&job.lease_owner)
        .bind(lease_ms)
        .bind(job.attempt_count)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

const COMPLETE_JOB_SQL: &str = r#"
update market_data_ingest_jobs
set
  status = 'completed',
  lease_owner = null,
  lease_expires_at = null,
  last_heartbeat_at = now(),
  last_error = null,
  updated_at = now()
where id = $1::uuid
  and lease_owner = $2
  and status = 'running'
  and attempt_count = $3
  and lease_expires_at >= now()
"#;

pub async fn complete_job(pool: &PgPool, job: &IngestJob) -> Result<bool> {
    let result = sqlx::query(COMPLETE_JOB_SQL)
        .bind(&job.id)
        .bind(&job.lease_owner)
        .bind(job.attempt_count)
        .execute(pool)
        .await?;
    Ok(result.rows_affected() > 0)
}

const REQUEUE_JOB_SQL: &str = r#"
update market_data_ingest_jobs
set
  status = 'queued',
  lease_owner = null,
  lease_expires_at = null,
  next_run_at = now() + ($2::bigint * interval '1 second'),
  last_error = $3,
  updated_at = now()
where id = $1::uuid
  and lease_owner = $4
  and status = 'running'
  and attempt_count = $5
  and lease_expires_at >= now()
"#;

const FAIL_JOB_SQL: &str = r#"
update market_data_ingest_jobs
set
  status = 'failed',
  lease_owner = null,
  lease_expires_at = null,
  last_error = $2,
  updated_at = now()
where id = $1::uuid
  and lease_owner = $3
  and status = 'running'
  and attempt_count = $4
  and lease_expires_at >= now()
"#;

pub async fn fail_job(
    pool: &PgPool,
    job: &IngestJob,
    message: &str,
    transient: bool,
) -> Result<bool> {
    if transient && job.attempt_count < job.max_attempts {
        let delay_seconds = 2_i64.pow(job.attempt_count.max(1).min(6) as u32);
        let result = sqlx::query(REQUEUE_JOB_SQL)
            .bind(&job.id)
            .bind(delay_seconds)
            .bind(message)
            .bind(&job.lease_owner)
            .bind(job.attempt_count)
            .execute(pool)
            .await?;
        return Ok(result.rows_affected() > 0);
    } else {
        let result = sqlx::query(FAIL_JOB_SQL)
            .bind(&job.id)
            .bind(message)
            .bind(&job.lease_owner)
            .bind(job.attempt_count)
            .execute(pool)
            .await?;
        return Ok(result.rows_affected() > 0);
    }
}

pub async fn fail_gex_jobs_with_failed_prerequisites(pool: &PgPool) -> Result<u64> {
    let result = sqlx::query(
        r#"
        with failed_prerequisites as (
          select distinct on (candidate.id)
            candidate.id,
            prerequisite.kind,
            prerequisite.last_error
          from market_data_ingest_jobs candidate
          join market_data_ingest_jobs prerequisite
            on prerequisite.symbol = candidate.symbol
           and prerequisite.kind = 'option_chain_snapshot'
           and prerequisite.status = 'failed'
           and coalesce(prerequisite.payload->>'dedupeBucket', '') =
             coalesce(candidate.payload->>'dedupeBucket', '')
          where candidate.kind = 'gex_snapshot'
            and candidate.status = 'queued'
            and coalesce(candidate.payload->>'dedupeBucket', '') <> ''
            and not exists (
              select 1
              from market_data_ingest_jobs completed
              where completed.symbol = candidate.symbol
                and completed.kind = 'option_chain_snapshot'
                and completed.status = 'completed'
                and coalesce(completed.payload->>'dedupeBucket', '') =
                  coalesce(candidate.payload->>'dedupeBucket', '')
            )
          order by
            candidate.id,
            prerequisite.updated_at desc nulls last,
            prerequisite.created_at desc
        )
        update market_data_ingest_jobs gex
        set
          status = 'failed',
          lease_owner = null,
          lease_expires_at = null,
          last_error = concat(
            'prerequisite ',
            failed.kind,
            ' failed: ',
            coalesce(nullif(failed.last_error, ''), 'unknown error')
          ),
          updated_at = now()
        from failed_prerequisites failed
        where gex.id = failed.id
        "#,
    )
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    fn normalized(sql: &str) -> String {
        sql.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    #[test]
    fn attempt_owned_updates_fence_by_attempt_count() {
        for (operation, sql, predicate) in [
            (
                "heartbeat",
                super::HEARTBEAT_JOB_SQL,
                "and attempt_count = $4",
            ),
            (
                "complete",
                super::COMPLETE_JOB_SQL,
                "and attempt_count = $3",
            ),
            ("requeue", super::REQUEUE_JOB_SQL, "and attempt_count = $5"),
            ("fail", super::FAIL_JOB_SQL, "and attempt_count = $4"),
        ] {
            assert!(
                normalized(sql).contains(predicate),
                "{operation} must fence the update by the claimed attempt"
            );
        }
    }

    #[test]
    fn heartbeat_cannot_resurrect_an_expired_lease() {
        for (operation, sql) in [
            ("heartbeat", super::HEARTBEAT_JOB_SQL),
            ("complete", super::COMPLETE_JOB_SQL),
            ("requeue", super::REQUEUE_JOB_SQL),
            ("fail", super::FAIL_JOB_SQL),
        ] {
            assert!(
                normalized(sql).contains("and lease_expires_at >= now()"),
                "{operation} after expiry must lose ownership"
            );
        }
    }

    #[test]
    fn gex_persistence_locks_its_completed_prerequisite_generation() {
        let source = include_str!("jobs.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        assert!(source.contains("lock_gex_prerequisite_tx"));
        assert!(source.contains("prerequisite.status = 'completed'"));
        assert!(source.contains("for update"));
        assert!(source.contains("prerequisite.payload->>'dedupebucket'"));
    }

    #[test]
    fn claim_initial_lease_expiry_uses_database_clock() {
        assert!(
            normalized(super::CLAIM_NEXT_JOB_SQL)
                .contains("lease_expires_at = now() + ($1::bigint * interval '1 millisecond')"),
            "claim expiry must be based on the same database clock used for reclamation"
        );
    }

    #[test]
    fn every_claim_gets_a_database_generated_never_reused_lease_token() {
        let sql = normalized(super::CLAIM_NEXT_JOB_SQL).to_ascii_lowercase();

        assert!(
            sql.contains("lease_owner = gen_random_uuid()::text"),
            "claim must replace the configured worker ID with a database-generated lease token"
        );
    }

    #[test]
    fn option_chain_generation_receipt_round_trips_and_fails_closed_when_erased() {
        let as_of = Utc.with_ymd_and_hms(2026, 7, 19, 1, 2, 3).unwrap();
        let receipt = super::option_chain_generation_receipt(as_of, 2).unwrap();

        assert_eq!(
            super::parse_option_chain_generation(&receipt).unwrap(),
            super::OptionChainGeneration {
                as_of,
                option_count: 2,
            }
        );
        for erased_or_invalid in [
            json!({ "dedupeBucket": 42 }),
            json!({ "optionChainAsOf": as_of.to_rfc3339() }),
            json!({ "optionChainAsOf": "not-a-time", "optionChainCount": 2 }),
            json!({ "optionChainAsOf": as_of.to_rfc3339(), "optionChainCount": "2" }),
        ] {
            assert!(
                super::parse_option_chain_generation(&erased_or_invalid).is_err(),
                "incomplete generation receipt must fail closed: {erased_or_invalid}"
            );
        }
    }

    #[test]
    fn option_chain_generation_receipt_update_is_atomic_and_attempt_fenced() {
        let sql = normalized(super::RECORD_OPTION_CHAIN_GENERATION_SQL).to_ascii_lowercase();

        for required in [
            "payload = coalesce(payload, '{}'::jsonb) || $4::jsonb",
            "and lease_owner = $2",
            "and attempt_count = $3",
            "and status = 'running'",
            "and lease_expires_at >= now()",
            "jsonb_typeof(payload) = 'object'",
        ] {
            assert!(
                sql.contains(required),
                "generation receipt update is missing {required}"
            );
        }
    }

    #[test]
    fn bucketed_gex_locks_the_completed_prerequisite_receipt() {
        let sql = normalized(super::LOCK_GEX_PREREQUISITE_SQL).to_ascii_lowercase();

        for required in [
            "prerequisite.status = 'completed'",
            "prerequisite.payload->>'dedupebucket'",
            "prerequisite.payload",
            "for update",
        ] {
            assert!(
                sql.contains(required),
                "GEX prerequisite receipt query is missing {required}"
            );
        }
    }
}
