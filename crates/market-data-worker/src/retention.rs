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
}

#[derive(Debug, Clone)]
struct RetentionResult {
    table: &'static str,
    retention_days: i64,
    cutoff: chrono::DateTime<Utc>,
    affected_rows: u64,
}

pub async fn run_retention(pool: &PgPool, config: &WorkerConfig, execute: bool) -> Result<()> {
    let targets = [
        RetentionTarget {
            table: "quote_cache",
            column: "as_of",
            retention_days: config.quote_retention_days,
        },
        RetentionTarget {
            table: "option_chain_snapshots",
            column: "as_of",
            retention_days: config.option_chain_retention_days,
        },
        RetentionTarget {
            table: "bar_cache",
            column: "starts_at",
            retention_days: config.bar_retention_days,
        },
        RetentionTarget {
            table: "gex_snapshots",
            column: "computed_at",
            retention_days: config.gex_retention_days,
        },
        RetentionTarget {
            table: "provider_request_log",
            column: "created_at",
            retention_days: config.provider_log_retention_days,
        },
    ];

    for result in apply_targets(pool, &targets, execute).await? {
        info!(
            table = result.table,
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
) -> Result<Vec<RetentionResult>> {
    let mut results = Vec::with_capacity(targets.len());
    for target in targets {
        let cutoff = retention_cutoff(Utc::now(), target.retention_days);
        let affected_rows = if execute {
            let sql = format!("delete from {} where {} < $1", target.table, target.column);
            sqlx::query(&sql)
                .bind(cutoff)
                .execute(pool)
                .await?
                .rows_affected()
        } else {
            let sql = format!(
                "select count(*)::bigint as count from {} where {} < $1",
                target.table, target.column
            );
            let row = sqlx::query(&sql).bind(cutoff).fetch_one(pool).await?;
            row.try_get::<i64, _>("count")?.max(0) as u64
        };
        results.push(RetentionResult {
            table: target.table,
            retention_days: target.retention_days,
            cutoff,
            affected_rows,
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
    use chrono::TimeZone;

    #[test]
    fn retention_cutoff_subtracts_configured_days() {
        let now = Utc.with_ymd_and_hms(2026, 5, 29, 12, 0, 0).unwrap();
        assert_eq!(
            retention_cutoff(now, 30),
            Utc.with_ymd_and_hms(2026, 4, 29, 12, 0, 0).unwrap()
        );
    }
}
