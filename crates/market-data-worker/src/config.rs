use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub database_url: String,
    pub worker_id: String,
    pub poll_interval_ms: u64,
    pub job_lease_ms: i64,
    pub market_data_provider: Option<MarketDataProviderConfig>,
}

#[derive(Debug, Clone)]
pub struct MarketDataProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key: String,
}

impl WorkerConfig {
    pub fn from_env() -> Result<Self> {
        let database_url = std::env::var("DATABASE_URL")
            .or_else(|_| build_pg_env_database_url())
            .map_err(|_| anyhow!("DATABASE_URL or PG* database env must be set"))?;
        let worker_id = std::env::var("MARKET_DATA_WORKER_ID").unwrap_or_else(|_| {
            format!("market-data-worker:{}", std::process::id())
        });
        Ok(Self {
            database_url,
            worker_id,
            poll_interval_ms: read_u64_env("MARKET_DATA_WORKER_POLL_MS", 3_000),
            job_lease_ms: read_i64_env("MARKET_DATA_JOB_LEASE_MS", 60_000),
            market_data_provider: read_market_data_provider_config(),
        })
    }
}

fn read_u64_env(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_i64_env(name: &str, fallback: i64) -> i64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn build_pg_env_database_url() -> Result<String, std::env::VarError> {
    let host = std::env::var("PGHOST")?;
    let database = std::env::var("PGDATABASE")?;
    let user = std::env::var("PGUSER")?;
    let password = std::env::var("PGPASSWORD").unwrap_or_default();
    let port = std::env::var("PGPORT").unwrap_or_else(|_| "5432".into());
    let auth = if password.is_empty() {
        user
    } else {
        format!("{user}:{password}")
    };
    Ok(format!("postgres://{auth}@{host}:{port}/{database}"))
}

fn first_env(names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| std::env::var(name).ok().filter(|value| !value.trim().is_empty()))
}

fn read_market_data_provider_config() -> Option<MarketDataProviderConfig> {
    if let Some(api_key) = first_env(&["MASSIVE_API_KEY", "MASSIVE_MARKET_DATA_API_KEY"]) {
        return Some(MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: std::env::var("MASSIVE_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.massive.com".into())
                .trim_end_matches('/')
                .to_string(),
            api_key,
        });
    }
    first_env(&["POLYGON_API_KEY", "POLYGON_KEY"]).map(|api_key| MarketDataProviderConfig {
        provider: "polygon".into(),
        base_url: std::env::var("POLYGON_BASE_URL")
            .unwrap_or_else(|_| "https://api.polygon.io".into())
            .trim_end_matches('/')
            .to_string(),
        api_key,
    })
}
