use anyhow::Result;
use sqlx::Row;
use tracing::info;

use crate::config::WorkerConfig;
use crate::db::connect_pool;

pub async fn run_doctor(config: &WorkerConfig) -> Result<()> {
    let pool = connect_pool(config).await?;
    let row = sqlx::query("select count(*)::bigint as count from market_data_ingest_jobs")
        .fetch_one(&pool)
        .await?;
    let count: i64 = row.try_get("count")?;
    info!(
        queued_table_rows = count,
        "market-data worker database check passed"
    );
    Ok(())
}
