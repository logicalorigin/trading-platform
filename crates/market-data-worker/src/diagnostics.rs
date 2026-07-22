use anyhow::{bail, Result};
use sqlx::Row;
use tracing::info;

use crate::config::WorkerConfig;
use crate::db::connect_pool;

pub async fn run_doctor(config: &WorkerConfig) -> Result<()> {
    let Some(provider) = config.market_data_provider.as_ref() else {
        bail!("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set");
    };
    let pool = connect_pool(config).await?;
    let row = sqlx::query("select count(*)::bigint as count from market_data_ingest_jobs")
        .fetch_one(&pool)
        .await?;
    let count: i64 = row.try_get("count")?;
    info!(
        queued_table_rows = count,
        provider = provider.provider,
        "market-data worker database check passed"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn doctor_logging_never_includes_the_provider_base_url() {
        let source = include_str!("diagnostics.rs");
        let production_source = source.split("#[cfg(test)]").next().unwrap();

        assert!(
            !production_source.contains("base_url = provider.base_url"),
            "doctor diagnostics must not log the configured provider base URL"
        );
    }
}
