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
    pub bar_retention_days: i64,
    pub bar_coarse_retention_days: i64,
    pub job_retention_days: i64,
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
        let db_pool_max_connections = read_u32_env("MARKET_DATA_WORKER_DB_POOL_MAX", 3).max(3);
        let db_acquire_timeout_ms = read_u64_env("MARKET_DATA_WORKER_DB_ACQUIRE_TIMEOUT_MS", 5_000);
        let minimum_job_lease_ms =
            db_acquire_timeout_ms.saturating_mul(3).min(i64::MAX as u64) as i64;
        Ok(Self {
            database_url,
            worker_id,
            db_pool_max_connections,
            db_acquire_timeout_ms,
            poll_interval_ms: read_u64_env("MARKET_DATA_WORKER_POLL_MS", 3_000),
            job_lease_ms: read_i64_env("MARKET_DATA_JOB_LEASE_MS", 60_000)
                .max(3_000)
                .max(minimum_job_lease_ms),
            option_chain_max_pages: read_usize_env("MARKET_DATA_OPTION_CHAIN_MAX_PAGES", 80),
            quote_retention_days: read_i64_env("MARKET_DATA_QUOTE_RETENTION_DAYS", 7),
            // bar_cache mixes intraday (short read window) and coarse/daily
            // (deep read window) series. MARKET_DATA_BAR_RETENTION_DAYS now scopes
            // the INTRADAY frames only (~90d). Coarse frames keep far longer so the
            // 6h sweep stops deleting 1d/12h/1w/1month history that consumers read
            // up to ~240 daily bars deep — a flat cut forced a wasteful universe-wide
            // provider re-fetch + re-persist on the next refresh.
            bar_retention_days: read_i64_env("MARKET_DATA_BAR_RETENTION_DAYS", 90),
            bar_coarse_retention_days: read_i64_env("MARKET_DATA_BAR_COARSE_RETENTION_DAYS", 730),
            job_retention_days: read_i64_env("MARKET_DATA_JOB_RETENTION_DAYS", 14),
            gex_retention_days: read_i64_env("MARKET_DATA_GEX_RETENTION_DAYS", 30),
            provider_log_retention_days: read_i64_env(
                "MARKET_DATA_PROVIDER_LOG_RETENTION_DAYS",
                14,
            ),
            // Background retention sweep cadence + chunk size. 6h keeps each sweep's
            // backlog small; 1k-row batches keep locks/WAL bounded without creating
            // long hot-table scans that compete with foreground chart hydration.
            retention_interval_secs: read_u64_env("MARKET_DATA_RETENTION_INTERVAL_SECS", 21_600),
            retention_batch_size: read_i64_env("MARKET_DATA_RETENTION_BATCH_SIZE", 1_000),
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
    let mut url =
        reqwest::Url::parse("postgresql://pghost.invalid").expect("static PostgreSQL URL is valid");
    let mut query = url.query_pairs_mut();
    query
        .append_pair("host", &host)
        .append_pair("port", &port)
        .append_pair("dbname", &database)
        .append_pair("user", &user);
    if !password.is_empty() {
        query.append_pair("password", &password);
    }
    if let Ok(ssl_mode) = std::env::var("PGSSLMODE") {
        query.append_pair("sslmode", &ssl_mode);
    }
    drop(query);
    Ok(url.into())
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

#[cfg(test)]
mod tests {
    use std::process::Command;
    use std::str::FromStr;

    use super::*;
    use sqlx::postgres::PgConnectOptions;

    #[test]
    fn job_lease_and_pool_capacity_protect_heartbeat() {
        const CHILD_MARKER: &str = "MARKET_DATA_LEASE_CONFIG_TEST_CHILD";
        const TEST_NAME: &str = "config::tests::job_lease_and_pool_capacity_protect_heartbeat";

        if std::env::var_os(CHILD_MARKER).is_some() {
            match WorkerConfig::from_env() {
                Ok(config) => {
                    assert!(
                        config.db_pool_max_connections >= 3,
                        "job work, retention, and heartbeat require separate pool connections"
                    );
                    assert!(
                        u64::try_from(config.job_lease_ms).unwrap_or_default()
                            >= config.db_acquire_timeout_ms.saturating_mul(3),
                        "lease must be at least three times the DB acquire timeout"
                    );
                }
                Err(error) => assert!(
                    [
                        "MARKET_DATA_JOB_LEASE_MS",
                        "MARKET_DATA_WORKER_DB_POOL_MAX",
                        "MARKET_DATA_WORKER_DB_ACQUIRE_TIMEOUT_MS",
                    ]
                    .iter()
                    .any(|setting| error.to_string().contains(setting)),
                    "rejection must identify an invalid heartbeat setting: {error}"
                ),
            }
            return;
        }

        let output = Command::new(std::env::current_exe().expect("current test executable"))
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_MARKER, "1")
            .env("DATABASE_URL", "postgres://lease-config-test")
            .env("MARKET_DATA_WORKER_DB_POOL_MAX", "1")
            .env("MARKET_DATA_WORKER_DB_ACQUIRE_TIMEOUT_MS", "5000")
            .env("MARKET_DATA_JOB_LEASE_MS", "3000")
            .output()
            .expect("run isolated config test");

        assert!(
            output.status.success(),
            "isolated config test failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn pg_environment_url_preserves_socket_and_reserved_credentials() {
        const CHILD_MARKER: &str = "MARKET_DATA_PG_CONFIG_TEST_CHILD";
        const TEST_NAME: &str =
            "config::tests::pg_environment_url_preserves_socket_and_reserved_credentials";

        if std::env::var_os(CHILD_MARKER).is_some() {
            let database_url = build_pg_env_database_url().expect("PG environment URL");
            let options = PgConnectOptions::from_str(&database_url).expect("SQLx options");
            assert_eq!(
                options.get_socket().and_then(|path| path.to_str()),
                Some("/var/run/postgresql")
            );
            assert_eq!(options.get_port(), 6_543);
            assert_eq!(options.get_username(), "u@:/?# name");
            assert_eq!(options.get_database(), Some("pyrus/name?"));
            assert!(reqwest::Url::parse(&database_url)
                .expect("encoded URL")
                .query_pairs()
                .any(|(key, value)| key == "password" && value == "p@:/?# % ü"));
            return;
        }

        let output = Command::new(std::env::current_exe().expect("current test executable"))
            .args(["--exact", TEST_NAME, "--nocapture"])
            .env(CHILD_MARKER, "1")
            .env_remove("DATABASE_URL")
            .env_remove("LOCAL_DATABASE_URL")
            .env("PGHOST", "/var/run/postgresql")
            .env("PGDATABASE", "pyrus/name?")
            .env("PGUSER", "u@:/?# name")
            .env("PGPASSWORD", "p@:/?# % ü")
            .env("PGPORT", "6543")
            .output()
            .expect("run isolated PG config test");

        assert!(
            output.status.success(),
            "isolated PG config test failed:\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
