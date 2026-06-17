use anyhow::Result;
use chrono::{DateTime, Duration, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgPool};

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

pub async fn claim_next_job(pool: &PgPool, config: &WorkerConfig) -> Result<Option<IngestJob>> {
    let lease_expires_at = Utc::now() + Duration::milliseconds(config.job_lease_ms);
    let job = sqlx::query_as::<_, IngestJob>(
        r#"
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
                    and prerequisite.kind = 'stock_snapshot'
                    and prerequisite.status = 'completed'
                    and coalesce(prerequisite.payload->>'dedupeBucket', '') =
                      coalesce(candidate.payload->>'dedupeBucket', '')
                )
                and exists (
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
          lease_owner = $1,
          lease_expires_at = $2,
          last_heartbeat_at = now(),
          attempt_count = jobs.attempt_count + case when jobs.status = 'queued' then 1 else 0 end,
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
        "#,
    )
    .bind(&config.worker_id)
    .bind(lease_expires_at)
    .fetch_optional(pool)
    .await?;
    Ok(job)
}

pub async fn heartbeat_job(pool: &PgPool, job: &IngestJob, lease_ms: i64) -> Result<bool> {
    let result = sqlx::query(
        r#"
        update market_data_ingest_jobs
        set
          lease_expires_at = now() + ($3::bigint * interval '1 millisecond'),
          last_heartbeat_at = now(),
          updated_at = now()
        where id = $1::uuid
          and lease_owner = $2
          and status = 'running'
        "#,
    )
    .bind(&job.id)
    .bind(&job.lease_owner)
    .bind(lease_ms)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn complete_job(pool: &PgPool, job: &IngestJob) -> Result<bool> {
    let result = sqlx::query(
        r#"
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
        "#,
    )
    .bind(&job.id)
    .bind(&job.lease_owner)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

pub async fn fail_job(
    pool: &PgPool,
    job: &IngestJob,
    message: &str,
    transient: bool,
) -> Result<bool> {
    if transient && job.attempt_count < job.max_attempts {
        let delay_seconds = 2_i64.pow(job.attempt_count.max(1).min(6) as u32);
        let next_run_at: DateTime<Utc> = Utc::now() + Duration::seconds(delay_seconds);
        let result = sqlx::query(
            r#"
            update market_data_ingest_jobs
            set
              status = 'queued',
              lease_owner = null,
              lease_expires_at = null,
              next_run_at = $2,
              last_error = $3,
              updated_at = now()
            where id = $1::uuid
              and lease_owner = $4
              and status = 'running'
            "#,
        )
        .bind(&job.id)
        .bind(next_run_at)
        .bind(message)
        .bind(&job.lease_owner)
        .execute(pool)
        .await?;
        return Ok(result.rows_affected() > 0);
    } else {
        let result = sqlx::query(
            r#"
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
            "#,
        )
        .bind(&job.id)
        .bind(message)
        .bind(&job.lease_owner)
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
           and prerequisite.kind in ('stock_snapshot', 'option_chain_snapshot')
           and prerequisite.status = 'failed'
           and coalesce(prerequisite.payload->>'dedupeBucket', '') =
             coalesce(candidate.payload->>'dedupeBucket', '')
          where candidate.kind = 'gex_snapshot'
            and candidate.status = 'queued'
            and coalesce(candidate.payload->>'dedupeBucket', '') <> ''
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
