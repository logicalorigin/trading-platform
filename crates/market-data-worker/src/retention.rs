use anyhow::Result;
use chrono::{Duration, Utc};
use sqlx::{PgPool, Row};
use tracing::info;

use crate::config::WorkerConfig;

#[derive(Debug, Clone)]
struct RetentionTarget {
    table: &'static str,
    column: &'static str,
    retention_days: i64,
    /// Optional extra AND predicate applied to both the delete and the dry-run
    /// count. STATIC SQL ONLY (never user input) — used to give bar_cache a
    /// per-timeframe retention window.
    extra_where: Option<&'static str>,
}

#[derive(Debug, Clone)]
struct RetentionResult {
    table: &'static str,
    retention_days: i64,
    cutoff: chrono::DateTime<Utc>,
    affected_rows: u64,
    scope: Option<&'static str>,
}

pub async fn run_retention(pool: &PgPool, config: &WorkerConfig, execute: bool) -> Result<()> {
    let targets = build_retention_targets(config);
    for result in apply_targets(pool, &targets, execute, config.retention_batch_size).await? {
        info!(
            table = result.table,
            scope = result.scope.unwrap_or("all"),
            retention_days = result.retention_days,
            cutoff = %result.cutoff,
            affected_rows = result.affected_rows,
            dry_run = !execute,
            "market-data retention target evaluated"
        );
    }
    Ok(())
}

fn build_retention_targets(config: &WorkerConfig) -> Vec<RetentionTarget> {
    vec![
        RetentionTarget {
            table: "quote_cache",
            column: "as_of",
            retention_days: config.quote_retention_days,
            extra_where: None,
        },
        // bar_cache holds both intraday (short read window) and coarse/daily
        // (deep read window) series. Prune them on separate clocks: a flat cut
        // deletes 1d bars the signal-monitor matrix reads ~240 deep, forcing a
        // wasteful provider re-fetch + re-persist every refresh. INTRADAY frames
        // keep config.bar_retention_days (~90d); EVERYTHING ELSE (1d/12h/1w/
        // 1month/10m + any future coarse frame) keeps config.bar_coarse_retention_days.
        RetentionTarget {
            table: "bar_cache",
            column: "starts_at",
            retention_days: config.bar_retention_days,
            extra_where: Some("timeframe in ('1m','2m','5m','15m','1h','5s')"),
        },
        RetentionTarget {
            table: "bar_cache",
            column: "starts_at",
            retention_days: config.bar_coarse_retention_days,
            extra_where: Some("timeframe not in ('1m','2m','5m','15m','1h','5s')"),
        },
        RetentionTarget {
            table: "market_data_ingest_jobs",
            column: "updated_at",
            retention_days: config.job_retention_days,
            extra_where: Some(MARKET_DATA_JOB_RETENTION_PREDICATE),
        },
        RetentionTarget {
            table: "gex_snapshots",
            column: "computed_at",
            retention_days: config.gex_retention_days,
            extra_where: None,
        },
        RetentionTarget {
            table: "provider_request_log",
            column: "created_at",
            retention_days: config.provider_log_retention_days,
            extra_where: None,
        },
    ]
}

const MARKET_DATA_JOB_RETENTION_PREDICATE: &str = "status in ('completed','failed','cancelled') \
and not (kind = 'option_chain_snapshot' and exists (select 1 \
from market_data_ingest_jobs gex where gex.kind = 'gex_snapshot' \
and gex.status in ('queued','running') and gex.symbol = market_data_ingest_jobs.symbol \
and coalesce(gex.payload->>'dedupeBucket', '') <> '' \
and coalesce(gex.payload->>'dedupeBucket', '') = coalesce(market_data_ingest_jobs.payload->>'dedupeBucket', '')))";

async fn apply_targets(
    pool: &PgPool,
    targets: &[RetentionTarget],
    execute: bool,
    batch_size: i64,
) -> Result<Vec<RetentionResult>> {
    let batch_size = batch_size.max(1);
    let mut results = Vec::with_capacity(targets.len());
    for target in targets {
        let cutoff = retention_cutoff(Utc::now(), target.retention_days);
        let extra = target
            .extra_where
            .map(|predicate| format!(" and {predicate}"))
            .unwrap_or_default();
        let affected_rows = if execute {
            // Delete in bounded chunks so each transaction stays small (locks/WAL
            // bounded), letting autovacuum keep pace on hot tables. cutoff is fixed
            // for the sweep, so the loop is finite.
            let sql = format!(
                "delete from {table} where ctid in \
                 (select ctid from {table} where {column} < $1{extra} limit {limit})",
                table = target.table,
                column = target.column,
                extra = extra,
                limit = batch_size,
            );
            let mut total: u64 = 0;
            loop {
                let removed = sqlx::query(&sql)
                    .bind(cutoff)
                    .execute(pool)
                    .await?
                    .rows_affected();
                total += removed;
                if removed == 0 {
                    break;
                }
            }
            total
        } else {
            let sql = format!(
                "select count(*)::bigint as count from {table} where {column} < $1{extra}",
                table = target.table,
                column = target.column,
                extra = extra,
            );
            let row = sqlx::query(&sql).bind(cutoff).fetch_one(pool).await?;
            row.try_get::<i64, _>("count")?.max(0) as u64
        };
        results.push(RetentionResult {
            table: target.table,
            retention_days: target.retention_days,
            cutoff,
            affected_rows,
            scope: target.extra_where,
        });
    }
    Ok(results)
}

fn retention_cutoff(now: chrono::DateTime<Utc>, retention_days: i64) -> chrono::DateTime<Utc> {
    now - Duration::days(retention_days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retention_targets_include_safe_terminal_job_cleanup() {
        let config = WorkerConfig {
            database_url: "postgres://example".into(),
            worker_id: "test-worker".into(),
            db_pool_max_connections: 2,
            db_acquire_timeout_ms: 5_000,
            poll_interval_ms: 3_000,
            job_lease_ms: 60_000,
            option_chain_max_pages: 80,
            quote_retention_days: 7,
            bar_retention_days: 90,
            bar_coarse_retention_days: 730,
            job_retention_days: 14,
            gex_retention_days: 30,
            provider_log_retention_days: 14,
            retention_interval_secs: 21_600,
            retention_batch_size: 20_000,
            market_data_provider: None,
        };

        let targets = build_retention_targets(&config);
        let target = targets
            .iter()
            .find(|target| target.table == "market_data_ingest_jobs")
            .expect("market_data_ingest_jobs retention target");

        assert_eq!(target.column, "updated_at");
        assert_eq!(target.retention_days, 14);
        let predicate = target.extra_where.expect("job retention predicate");
        assert!(predicate.contains("status in ('completed','failed','cancelled')"));
        assert!(predicate.contains("kind = 'option_chain_snapshot'"));
        assert!(predicate.contains("gex.kind = 'gex_snapshot'"));
        assert!(predicate.contains("gex.status in ('queued','running')"));
        assert!(predicate.contains("dedupeBucket"));
    }
}
