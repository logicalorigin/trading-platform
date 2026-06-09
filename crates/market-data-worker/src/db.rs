use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::time::Duration;

use crate::config::WorkerConfig;

pub async fn connect_pool(config: &WorkerConfig) -> Result<PgPool> {
    Ok(PgPoolOptions::new()
        .min_connections(0)
        .max_connections(config.db_pool_max_connections)
        .acquire_timeout(Duration::from_millis(config.db_acquire_timeout_ms))
        .connect_lazy(&config.database_url)?)
}
