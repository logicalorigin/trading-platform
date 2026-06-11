mod compute;
mod config;
mod db;
mod diagnostics;
mod ingest;
mod jobs;
mod providers;
mod retention;

use std::future::Future;
use std::time::Duration;
use std::time::Instant;

use anyhow::{bail, Result};
use chrono::{DateTime, Utc};
use clap::{Parser, Subcommand};
use reqwest::StatusCode;
use serde_json::json;
use tracing::{error, info, warn};

use crate::compute::gex::compute_and_persist_gex_snapshot;
use crate::config::WorkerConfig;
use crate::db::connect_pool;
use crate::ingest::{
    persist_option_chain_snapshots, persist_provider_request_log, persist_stock_snapshot,
    ProviderRequestLogInput,
};
use crate::jobs::{
    claim_next_job, complete_job, fail_gex_jobs_with_failed_prerequisites, fail_job, heartbeat_job,
    IngestJob,
};
use crate::providers::massive::{
    fetch_option_chain_snapshots, fetch_stock_snapshot, OptionChainFetchResult,
};

#[derive(Debug, Parser)]
#[command(name = "market-data-worker")]
#[command(about = "PYRUS market-data ingest and compute worker")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Doctor,
    Run {
        #[arg(long)]
        max_jobs: Option<usize>,
    },
    Once {
        #[arg(long)]
        kind: String,
        #[arg(long)]
        symbol: String,
    },
    #[command(hide = true)]
    Backfill {
        #[arg(long)]
        kind: String,
        #[arg(long, value_delimiter = ',')]
        symbols: Vec<String>,
        #[arg(long)]
        from: Option<String>,
        #[arg(long)]
        to: Option<String>,
    },
    Retention {
        #[arg(long)]
        execute: bool,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "market_data_worker=info,info".into()),
        )
        .init();

    let cli = Cli::parse();
    let config = WorkerConfig::from_env()?;

    match cli.command {
        Command::Doctor => diagnostics::run_doctor(&config).await,
        Command::Run { max_jobs } => run_loop(config, max_jobs).await,
        Command::Once { kind, symbol } => run_once(config, &kind, &symbol).await,
        Command::Backfill {
            kind,
            symbols,
            from,
            to,
        } => {
            bail!(
                "{}",
                backfill_not_implemented_message(&kind, &symbols, &from, &to)
            )
        }
        Command::Retention { execute } => {
            let pool = connect_pool(&config).await?;
            retention::run_retention(&pool, &config, execute).await
        }
    }
}

fn backfill_not_implemented_message(
    kind: &str,
    symbols: &[String],
    from: &Option<String>,
    to: &Option<String>,
) -> String {
    format!(
        "backfill is not implemented yet (kind={kind}, symbols={}, from={from:?}, to={to:?})",
        symbols.join(",")
    )
}

async fn run_once(config: WorkerConfig, kind: &str, symbol: &str) -> Result<()> {
    let pool = connect_pool(&config).await?;
    match kind {
        "stock_snapshot" => {
            let provider = config.market_data_provider.as_ref().ok_or_else(|| {
                anyhow::anyhow!("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set")
            })?;
            let client = reqwest::Client::new();
            let started_at = Instant::now();
            let snapshot = match fetch_stock_snapshot(&client, provider, symbol).await {
                Ok(fetch) => {
                    log_provider_request(
                        &pool,
                        &provider.provider,
                        "stock_snapshot",
                        symbol,
                        started_at,
                        "ok",
                        fetch.metadata.http_status,
                        Some(1),
                        Some(1),
                        fetch.metadata.rate_limit_reset_at,
                        None,
                    )
                    .await?;
                    fetch.snapshot
                }
                Err(error) => {
                    log_provider_request(
                        &pool,
                        &provider.provider,
                        "stock_snapshot",
                        symbol,
                        started_at,
                        "error",
                        http_status_from_error(&error),
                        None,
                        Some(1),
                        None,
                        Some(error.to_string()),
                    )
                    .await?;
                    return Err(error);
                }
            };
            persist_stock_snapshot(&pool, symbol, &provider.provider, &snapshot).await?;
            info!(
                symbol = snapshot.symbol,
                provider = provider.provider,
                last = snapshot.last,
                as_of = %snapshot.as_of,
                "persisted stock snapshot"
            );
            Ok(())
        }
        "option_chain_snapshot" => {
            let provider = config.market_data_provider.as_ref().ok_or_else(|| {
                anyhow::anyhow!("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set")
            })?;
            let client = reqwest::Client::new();
            let started_at = Instant::now();
            let fetch = match fetch_option_chain_snapshots(
                &client,
                provider,
                symbol,
                config.option_chain_max_pages,
            )
            .await
            {
                Ok(fetch) => fetch,
                Err(error) => {
                    log_provider_request(
                        &pool,
                        &provider.provider,
                        "option_chain_snapshot",
                        symbol,
                        started_at,
                        "error",
                        http_status_from_error(&error),
                        None,
                        None,
                        None,
                        Some(error.to_string()),
                    )
                    .await?;
                    return Err(error);
                }
            };
            log_provider_request(
                &pool,
                &provider.provider,
                "option_chain_snapshot",
                symbol,
                started_at,
                if fetch.truncated { "partial" } else { "ok" },
                fetch.metadata.http_status,
                Some(fetch.snapshots.len()),
                Some(fetch.page_count),
                fetch.metadata.rate_limit_reset_at,
                fetch
                    .truncated
                    .then(|| format!("option-chain response exceeded {} pages", fetch.page_count)),
            )
            .await?;
            ensure_complete_option_chain(&fetch, symbol)?;
            let persisted =
                persist_option_chain_snapshots(&pool, symbol, &provider.provider, &fetch.snapshots)
                    .await?;
            info!(
                symbol = symbol.trim().to_uppercase(),
                provider = provider.provider,
                persisted,
                "persisted option-chain snapshots"
            );
            Ok(())
        }
        "gex_snapshot" => {
            let summary = compute_and_persist_gex_snapshot(&pool, symbol).await?;
            info!(
                symbol = summary.symbol,
                option_count = summary.option_count,
                usable_option_count = summary.usable_option_count,
                net_gex = summary.net_gex,
                "computed GEX snapshot"
            );
            Ok(())
        }
        other => bail!("unsupported once job kind: {other}"),
    }
}

async fn run_loop(config: WorkerConfig, max_jobs: Option<usize>) -> Result<()> {
    let pool = connect_pool(&config).await?;
    info!(
        worker_id = config.worker_id,
        poll_ms = config.poll_interval_ms,
        max_jobs = ?max_jobs,
        "market-data worker started"
    );

    // Background retention sweep: keeps cache tables (bar_cache, option_chain_snapshots,
    // quote_cache, gex_snapshots, provider_request_log) bounded so they don't bloat and
    // stall queries / starve the API event loop (which otherwise gets the dev workflow
    // killed and restarted by Replit). Runs concurrently with job processing and deletes
    // in small batches. Only in the long-running worker, not the bounded drain mode.
    if max_jobs.is_none() {
        let pool = pool.clone();
        let config = config.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(120)).await;
            loop {
                match retention::run_retention(&pool, &config, true).await {
                    Ok(()) => info!("scheduled retention sweep complete"),
                    Err(error) => warn!(err = %error, "scheduled retention sweep failed"),
                }
                tokio::time::sleep(Duration::from_secs(config.retention_interval_secs)).await;
            }
        });
    }

    let mut completed_jobs = 0usize;
    loop {
        if max_jobs.is_some_and(|limit| completed_jobs >= limit) {
            info!(completed_jobs, "market-data worker reached max job limit");
            return Ok(());
        }
        match fail_gex_jobs_with_failed_prerequisites(&pool).await {
            Ok(count) if count > 0 => {
                info!(
                    count,
                    "marked queued gex jobs failed because prerequisites failed"
                );
            }
            Ok(_) => {}
            Err(error) => {
                error!(err = %error, "market-data worker prerequisite reconciliation failed");
            }
        }
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("market-data worker shutting down");
                return Ok(());
            }
            result = claim_next_job(&pool, &config) => {
                match result {
                    Ok(Some(job)) => {
                        if let Err(error) = process_job(&pool, &config, &job).await {
                            warn!(err = %error, job_id = %job.id, kind = %job.kind, symbol = %job.symbol, "market-data job failed");
                            let transient = is_transient_job_error(&error);
                            if !fail_job(&pool, &job, &error.to_string(), transient).await? {
                                warn!(job_id = %job.id, lease_owner = %job.lease_owner, "market-data job failure was not recorded because the lease moved");
                            }
                        } else {
                            if !complete_job(&pool, &job).await? {
                                warn!(job_id = %job.id, lease_owner = %job.lease_owner, "market-data job completion was not recorded because the lease moved");
                            }
                        }
                        completed_jobs += 1;
                    }
                    Ok(None) => {
                        if max_jobs.is_some() {
                            info!(completed_jobs, "market-data worker drain found no queued jobs");
                            return Ok(());
                        }
                        tokio::time::sleep(Duration::from_millis(config.poll_interval_ms)).await;
                    }
                    Err(error) => {
                        error!(err = %error, "market-data worker claim loop failed");
                        tokio::time::sleep(Duration::from_millis(config.poll_interval_ms)).await;
                    }
                }
            }
        }
    }
}

async fn process_job(pool: &sqlx::PgPool, config: &WorkerConfig, job: &IngestJob) -> Result<()> {
    match job.kind.as_str() {
        "stock_snapshot" => {
            let provider = config.market_data_provider.as_ref().ok_or_else(|| {
                anyhow::anyhow!("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set")
            })?;
            let client = reqwest::Client::new();
            with_job_heartbeat(pool, config, job, async {
                let started_at = Instant::now();
                let snapshot = match fetch_stock_snapshot(&client, provider, &job.symbol).await {
                    Ok(fetch) => {
                        log_provider_request(
                            pool,
                            &provider.provider,
                            "stock_snapshot",
                            &job.symbol,
                            started_at,
                            "ok",
                            fetch.metadata.http_status,
                            Some(1),
                            Some(1),
                            fetch.metadata.rate_limit_reset_at,
                            None,
                        )
                        .await?;
                        fetch.snapshot
                    }
                    Err(error) => {
                        log_provider_request(
                            pool,
                            &provider.provider,
                            "stock_snapshot",
                            &job.symbol,
                            started_at,
                            "error",
                            http_status_from_error(&error),
                            None,
                            Some(1),
                            None,
                            Some(error.to_string()),
                        )
                        .await?;
                        return Err(error);
                    }
                };
                persist_stock_snapshot(pool, &job.symbol, &provider.provider, &snapshot).await?;
                info!(
                    symbol = snapshot.symbol,
                    provider = provider.provider,
                    last = snapshot.last,
                    as_of = %snapshot.as_of,
                    "persisted stock snapshot"
                );
                Ok(())
            })
            .await
        }
        "gex_snapshot" => {
            with_job_heartbeat(pool, config, job, async {
                compute_and_persist_gex_snapshot(pool, &job.symbol).await?;
                Ok(())
            })
            .await
        }
        "option_chain_snapshot" => {
            let provider = config.market_data_provider.as_ref().ok_or_else(|| {
                anyhow::anyhow!("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set")
            })?;
            let client = reqwest::Client::new();
            with_job_heartbeat(pool, config, job, async {
                let started_at = Instant::now();
                let fetch = match fetch_option_chain_snapshots(
                    &client,
                    provider,
                    &job.symbol,
                    config.option_chain_max_pages,
                )
                .await
                {
                    Ok(fetch) => fetch,
                    Err(error) => {
                        log_provider_request(
                            pool,
                            &provider.provider,
                            "option_chain_snapshot",
                            &job.symbol,
                            started_at,
                            "error",
                            http_status_from_error(&error),
                            None,
                            None,
                            None,
                            Some(error.to_string()),
                        )
                        .await?;
                        return Err(error);
                    }
                };
                log_provider_request(
                    pool,
                    &provider.provider,
                    "option_chain_snapshot",
                    &job.symbol,
                    started_at,
                    if fetch.truncated { "partial" } else { "ok" },
                    fetch.metadata.http_status,
                    Some(fetch.snapshots.len()),
                    Some(fetch.page_count),
                    fetch.metadata.rate_limit_reset_at,
                    fetch.truncated.then(|| {
                        format!("option-chain response exceeded {} pages", fetch.page_count)
                    }),
                )
                .await?;
                ensure_complete_option_chain(&fetch, &job.symbol)?;
                let persisted = persist_option_chain_snapshots(
                    pool,
                    &job.symbol,
                    &provider.provider,
                    &fetch.snapshots,
                )
                .await?;
                info!(
                    symbol = job.symbol,
                    provider = provider.provider,
                    persisted,
                    "persisted option-chain snapshots"
                );
                Ok(())
            })
            .await
        }
        other => bail!("unsupported market-data job kind: {other}"),
    }
}

fn ensure_complete_option_chain(fetch: &OptionChainFetchResult, symbol: &str) -> Result<()> {
    if fetch.truncated {
        bail!(
            "option-chain snapshot truncated after {} pages for {}",
            fetch.page_count,
            symbol.trim().to_uppercase()
        );
    }
    Ok(())
}

async fn with_job_heartbeat<F, T>(
    pool: &sqlx::PgPool,
    config: &WorkerConfig,
    job: &IngestJob,
    future: F,
) -> Result<T>
where
    F: Future<Output = Result<T>>,
{
    let heartbeat_pool = pool.clone();
    let heartbeat_target = job.clone();
    let lease_ms = config.job_lease_ms;
    let interval_ms = (lease_ms / 3).clamp(1_000, 30_000) as u64;
    let handle = tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_millis(interval_ms)).await;
            match heartbeat_job(&heartbeat_pool, &heartbeat_target, lease_ms).await {
                Ok(true) => {}
                Ok(false) => {
                    warn!(
                        job_id = %heartbeat_target.id,
                        lease_owner = %heartbeat_target.lease_owner,
                        "market-data heartbeat skipped because the lease moved"
                    );
                    return;
                }
                Err(error) => {
                    warn!(
                        err = %error,
                        job_id = %heartbeat_target.id,
                        "market-data heartbeat failed"
                    );
                }
            }
        }
    });
    let result = future.await;
    handle.abort();
    result
}

async fn log_provider_request(
    pool: &sqlx::PgPool,
    provider: &str,
    endpoint_family: &str,
    symbol: &str,
    started_at: Instant,
    status: &str,
    http_status: Option<i32>,
    row_count: Option<usize>,
    page_count: Option<usize>,
    rate_limit_reset_at: Option<DateTime<Utc>>,
    error_message: Option<String>,
) -> Result<()> {
    let duration_ms = started_at.elapsed().as_millis().min(i32::MAX as u128) as i32;
    let request_key = format!("{endpoint_family}:{}", symbol.trim().to_uppercase());
    let error_code = http_status.map(|status| status.to_string());
    let metadata = (status == "partial").then(|| {
        json!({
            "truncated": true,
            "message": error_message.as_deref()
        })
    });
    persist_provider_request_log(
        pool,
        ProviderRequestLogInput {
            provider,
            endpoint_family,
            symbol: Some(symbol),
            request_key: Some(&request_key),
            status,
            http_status,
            duration_ms: Some(duration_ms),
            row_count: row_count.map(|value| value.min(i32::MAX as usize) as i32),
            page_count: page_count.map(|value| value.min(i32::MAX as usize) as i32),
            retry_count: 0,
            rate_limit_reset_at,
            error_code: error_code.as_deref(),
            error_message: error_message.as_deref(),
            metadata,
        },
    )
    .await
}

fn http_status_from_error(error: &anyhow::Error) -> Option<i32> {
    error
        .downcast_ref::<reqwest::Error>()
        .and_then(|error| error.status())
        .map(|status| status.as_u16() as i32)
}

fn is_transient_job_error(error: &anyhow::Error) -> bool {
    if let Some(status) = error
        .downcast_ref::<reqwest::Error>()
        .and_then(|error| error.status())
    {
        return status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error();
    }

    let message = error.to_string();
    !(message.contains("unsupported market-data job kind")
        || message.contains("unsupported once job kind")
        || message.contains("symbol is required")
        || message.contains("MASSIVE_API_KEY or MASSIVE_MARKET_DATA_API_KEY must be set")
        || message.contains("provider returned no usable stock snapshot")
        || message.contains("provider returned no option-chain snapshots")
        || message.contains("option-chain snapshot truncated"))
}
