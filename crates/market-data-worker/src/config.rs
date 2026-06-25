use anyhow::{anyhow, Result};

#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub database_url: String,
    pub worker_id: String,
    pub db_pool_max_connections: u32,
    pub db_acquire_timeout_ms: u64,
    pub poll_interval_ms: u64,
    pub job_lease_ms: i64,
    pub option_chain_max_pages: usize,
    pub quote_retention_days: i64,
    pub option_chain_retention_days: i64,
    pub bar_retention_days: i64,
    pub bar_coarse_retention_days: i64,
    pub gex_retention_days: i64,
    pub provider_log_retention_days: i64,
    pub retention_interval_secs: u64,
    pub retention_batch_size: i64,
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
            .or_else(|_| std::env::var("LOCAL_DATABASE_URL"))
            .or_else(|_| build_pg_env_database_url())
            .map_err(|_| {
                anyhow!("DATABASE_URL, LOCAL_DATABASE_URL, or PG* database env must be set")
            })?;
        let worker_id = std::env::var("MARKET_DATA_WORKER_ID")
            .unwrap_or_else(|_| format!("market-data-worker:{}", std::process::id()));
        Ok(Self {
            database_url,
            worker_id,
            db_pool_max_connections: read_u32_env("MARKET_DATA_WORKER_DB_POOL_MAX", 2),
            db_acquire_timeout_ms: read_u64_env("MARKET_DATA_WORKER_DB_ACQUIRE_TIMEOUT_MS", 5_000),
            poll_interval_ms: read_u64_env("MARKET_DATA_WORKER_POLL_MS", 3_000),
            job_lease_ms: read_i64_env("MARKET_DATA_JOB_LEASE_MS", 60_000),
            option_chain_max_pages: read_usize_env("MARKET_DATA_OPTION_CHAIN_MAX_PAGES", 80),
            quote_retention_days: read_i64_env("MARKET_DATA_QUOTE_RETENTION_DAYS", 7),
            option_chain_retention_days: read_i64_env("MARKET_DATA_OPTION_CHAIN_RETENTION_DAYS", 7),
            // bar_cache mixes intraday (short read window) and coarse/daily
            // (deep read window) series. MARKET_DATA_BAR_RETENTION_DAYS now scopes
            // the INTRADAY frames only (~90d). Coarse frames keep far longer so the
            // 6h sweep stops deleting 1d/12h/1w/1month history that consumers read
            // up to ~240 daily bars deep — a flat cut forced a wasteful universe-wide
            // provider re-fetch + re-persist on the next refresh.
            bar_retention_days: read_i64_env("MARKET_DATA_BAR_RETENTION_DAYS", 90),
            bar_coarse_retention_days: read_i64_env(
                "MARKET_DATA_BAR_COARSE_RETENTION_DAYS",
                730,
            ),
            gex_retention_days: read_i64_env("MARKET_DATA_GEX_RETENTION_DAYS", 30),
            provider_log_retention_days: read_i64_env(
                "MARKET_DATA_PROVIDER_LOG_RETENTION_DAYS",
                14,
            ),
            // Background retention sweep cadence + chunk size. 6h keeps each sweep's
            // backlog small; 20k-row batches keep locks/WAL bounded on the hot tables.
            retention_interval_secs: read_u64_env("MARKET_DATA_RETENTION_INTERVAL_SECS", 21_600),
            retention_batch_size: read_i64_env("MARKET_DATA_RETENTION_BATCH_SIZE", 20_000),
            market_data_provider: read_market_data_provider_config(),
        })
    }
}

fn read_u32_env(name: &str, fallback: u32) -> u32 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
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

fn read_usize_env(name: &str, fallback: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
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
    names.iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .filter(|value| !value.trim().is_empty())
    })
}

fn read_market_data_provider_config() -> Option<MarketDataProviderConfig> {
    first_env(&["MASSIVE_API_KEY", "MASSIVE_MARKET_DATA_API_KEY"]).map(|api_key| {
        MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: std::env::var("MASSIVE_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.massive.com".into())
                .trim_end_matches('/')
                .to_string(),
            api_key,
        }
    })
}
