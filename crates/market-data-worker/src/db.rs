use anyhow::Result;
use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::config::WorkerConfig;

pub async fn connect_pool(config: &WorkerConfig) -> Result<PgPool> {
    Ok(PgPoolOptions::new()
        .max_connections(5)
        .connect(&config.database_url)
        .await?)
}
