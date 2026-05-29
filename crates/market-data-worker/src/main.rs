mod compute;
mod config;
mod db;
mod diagnostics;
mod ingest;
mod jobs;
mod providers;

use std::time::Duration;

use anyhow::{bail, Result};
use clap::{Parser, Subcommand};
use tracing::{error, info, warn};

use crate::compute::gex::compute_and_persist_gex_snapshot;
use crate::config::WorkerConfig;
use crate::db::connect_pool;
use crate::ingest::persist_option_chain_snapshots;
use crate::jobs::{claim_next_job, complete_job, fail_job, IngestJob};
use crate::providers::polygon::fetch_option_chain_snapshots;

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
    Run,
    Once {
        #[arg(long)]
        kind: String,
        #[arg(long)]
        symbol: String,
    },
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
        Command::Run => run_loop(config).await,
        Command::Once { kind, symbol } => run_once(config, &kind, &symbol).await,
        Command::Backfill {
            kind,
            symbols,
            from,
            to,
        } => {
            bail!(
                "backfill is not implemented yet (kind={kind}, symbols={}, from={from:?}, to={to:?})",
                symbols.join(",")
            )
        }
    }
}

async fn run_once(config: WorkerConfig, kind: &str, symbol: &str) -> Result<()> {
    let pool = connect_pool(&config).await?;
    match kind {
        "option_chain_snapshot" => {
            let provider = config
                .market_data_provider
                .ok_or_else(|| anyhow::anyhow!("MASSIVE_API_KEY or POLYGON_API_KEY must be set"))?;
            let client = reqwest::Client::new();
            let snapshots = fetch_option_chain_snapshots(&client, &provider, symbol, 20).await?;
            let persisted =
                persist_option_chain_snapshots(&pool, symbol, &provider.provider, &snapshots)
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

async fn run_loop(config: WorkerConfig) -> Result<()> {
    let pool = connect_pool(&config).await?;
    info!(
        worker_id = config.worker_id,
        poll_ms = config.poll_interval_ms,
        "market-data worker started"
    );

    loop {
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {
                info!("market-data worker shutting down");
                return Ok(());
            }
            result = claim_next_job(&pool, &config) => {
                match result {
                    Ok(Some(job)) => {
                        if let Err(error) = process_job(&pool, &job).await {
                            warn!(err = %error, job_id = %job.id, kind = %job.kind, symbol = %job.symbol, "market-data job failed");
                            fail_job(&pool, &job, &error.to_string(), true).await?;
                        } else {
                            complete_job(&pool, &job.id).await?;
                        }
                    }
                    Ok(None) => {
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

async fn process_job(pool: &sqlx::PgPool, job: &IngestJob) -> Result<()> {
    match job.kind.as_str() {
        "gex_snapshot" => {
            compute_and_persist_gex_snapshot(pool, &job.symbol).await?;
            Ok(())
        }
        "option_chain_snapshot" => {
            let config = WorkerConfig::from_env()?;
            let provider = config
                .market_data_provider
                .ok_or_else(|| anyhow::anyhow!("MASSIVE_API_KEY or POLYGON_API_KEY must be set"))?;
            let client = reqwest::Client::new();
            let snapshots =
                fetch_option_chain_snapshots(&client, &provider, &job.symbol, 20).await?;
            let persisted = persist_option_chain_snapshots(
                pool,
                &job.symbol,
                &provider.provider,
                &snapshots,
            )
            .await?;
            info!(
                symbol = job.symbol,
                provider = provider.provider,
                persisted,
                "persisted option-chain snapshots"
            );
            Ok(())
        }
        other => bail!("unsupported market-data job kind: {other}"),
    }
}
