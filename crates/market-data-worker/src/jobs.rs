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
    pub attempt_count: i32,
    pub max_attempts: i32,
    #[allow(dead_code)]
    pub payload: Option<Value>,
}

pub async fn claim_next_job(
    pool: &PgPool,
    config: &WorkerConfig,
) -> Result<Option<IngestJob>> {
    let lease_expires_at = Utc::now() + Duration::milliseconds(config.job_lease_ms);
    let job = sqlx::query_as::<_, IngestJob>(
        r#"
        with next_job as (
          select id
          from market_data_ingest_jobs
          where
            (
              status = 'queued'
              and (next_run_at is null or next_run_at <= now())
            )
            or (
              status = 'running'
              and lease_expires_at < now()
            )
          order by priority asc, created_at asc
          for update skip locked
          limit 1
        )
        update market_data_ingest_jobs jobs
        set
          status = 'running',
          lease_owner = $1,
          lease_expires_at = $2,
          last_heartbeat_at = now(),
          attempt_count = jobs.attempt_count + 1,
          updated_at = now()
        where jobs.id = (select id from next_job)
        returning
          jobs.id::text as id,
          jobs.kind,
          jobs.symbol,
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

#[allow(dead_code)]
pub async fn heartbeat_job(pool: &PgPool, job_id: &str) -> Result<()> {
    sqlx::query(
        r#"
        update market_data_ingest_jobs
        set last_heartbeat_at = now(), updated_at = now()
        where id = $1::uuid and status = 'running'
        "#,
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn complete_job(pool: &PgPool, job_id: &str) -> Result<()> {
    sqlx::query(
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
        "#,
    )
    .bind(job_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn fail_job(
    pool: &PgPool,
    job: &IngestJob,
    message: &str,
    transient: bool,
) -> Result<()> {
    if transient && job.attempt_count < job.max_attempts {
        let delay_seconds = 2_i64.pow(job.attempt_count.max(1).min(6) as u32);
        let next_run_at: DateTime<Utc> = Utc::now() + Duration::seconds(delay_seconds);
        sqlx::query(
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
            "#,
        )
        .bind(&job.id)
        .bind(next_run_at)
        .bind(message)
        .execute(pool)
        .await?;
    } else {
        sqlx::query(
            r#"
            update market_data_ingest_jobs
            set
              status = 'failed',
              lease_owner = null,
              lease_expires_at = null,
              last_error = $2,
              updated_at = now()
            where id = $1::uuid
            "#,
        )
        .bind(&job.id)
        .bind(message)
        .execute(pool)
        .await?;
    }
    Ok(())
}
