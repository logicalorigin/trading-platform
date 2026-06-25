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
    let targets = [
        RetentionTarget {
            table: "quote_cache",
            column: "as_of",
            retention_days: config.quote_retention_days,
            extra_where: None,
        },
        RetentionTarget {
            table: "option_chain_snapshots",
            column: "as_of",
            retention_days: config.option_chain_retention_days,
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
    ];

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
