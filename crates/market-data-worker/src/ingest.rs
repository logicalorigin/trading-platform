use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::jobs::{lock_job_attempt_tx, record_option_chain_generation_tx, IngestJob};
use crate::providers::massive::OptionChainSnapshot;

const DEFAULT_OPTION_CHAIN_WRITE_BATCH_SIZE: usize = 128;
const MAX_OPTION_CHAIN_WRITE_BATCH_SIZE: usize = 512;
const DEFAULT_OPTION_CHAIN_WRITE_THROTTLE_MS: u64 = 75;

fn read_positive_usize_env(name: &str, fallback: usize) -> usize {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(fallback)
}

fn read_u64_env(name: &str, fallback: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(fallback)
}

fn option_chain_write_batch_size() -> usize {
    read_positive_usize_env(
        "MARKET_DATA_OPTION_CHAIN_WRITE_BATCH_SIZE",
        DEFAULT_OPTION_CHAIN_WRITE_BATCH_SIZE,
    )
    .min(MAX_OPTION_CHAIN_WRITE_BATCH_SIZE)
}

fn option_chain_write_throttle_ms() -> u64 {
    read_u64_env(
        "MARKET_DATA_OPTION_CHAIN_WRITE_THROTTLE_MS",
        DEFAULT_OPTION_CHAIN_WRITE_THROTTLE_MS,
    )
}

pub struct ProviderRequestLogInput<'a> {
    pub provider: &'a str,
    pub endpoint_family: &'a str,
    pub symbol: Option<&'a str>,
    pub request_key: Option<&'a str>,
    pub status: &'a str,
    pub http_status: Option<i32>,
    pub duration_ms: Option<i32>,
    pub row_count: Option<i32>,
    pub page_count: Option<i32>,
    pub retry_count: i32,
    pub rate_limit_reset_at: Option<DateTime<Utc>>,
    pub error_code: Option<&'a str>,
    pub error_message: Option<&'a str>,
    pub metadata: Option<Value>,
}

pub async fn persist_provider_request_log(
    pool: &PgPool,
    input: ProviderRequestLogInput<'_>,
) -> Result<()> {
    sqlx::query(
        r#"
        insert into provider_request_log (
          provider,
          endpoint_family,
          symbol,
          request_key,
          status,
          http_status,
          duration_ms,
          row_count,
          page_count,
          retry_count,
          rate_limit_reset_at,
          error_code,
          error_message,
          metadata,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, $13, $14, now()
        )
        "#,
    )
    .bind(input.provider)
    .bind(input.endpoint_family)
    .bind(input.symbol)
    .bind(input.request_key)
    .bind(input.status)
    .bind(input.http_status)
    .bind(input.duration_ms)
    .bind(input.row_count)
    .bind(input.page_count)
    .bind(input.retry_count)
    .bind(input.rate_limit_reset_at)
    .bind(input.error_code)
    .bind(input.error_message)
    .bind(input.metadata)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn persist_option_chain_snapshots(
    pool: &PgPool,
    underlying: &str,
    provider: &str,
    snapshots: &[OptionChainSnapshot],
    job: Option<&IngestJob>,
) -> Result<usize> {
    let symbol = underlying.trim().to_uppercase();
    if symbol.is_empty()
        || snapshots
            .iter()
            .any(|snapshot| snapshot.ticker.trim().eq_ignore_ascii_case(&symbol))
    {
        return Err(anyhow!("invalid option-chain underlying identity"));
    }
    let unique_snapshots = unique_option_chain_snapshots(snapshots)?;
    let batch_size = option_chain_write_batch_size();
    let throttle_ms = option_chain_write_throttle_ms();
    let total = unique_snapshots.len();
    let mut persisted = 0usize;

    let mut tx = pool.begin().await?;
    let as_of = sqlx::query_scalar::<_, DateTime<Utc>>("select now()")
        .fetch_one(&mut *tx)
        .await?;
    let underlying_id = ensure_instrument_tx(&mut tx, &symbol, "equity", None).await?;

    for batch in unique_snapshots.chunks(batch_size) {
        let option_instrument_ids = ensure_option_instruments_tx(&mut tx, &symbol, batch).await?;
        let option_contract_ids =
            ensure_option_contracts_tx(&mut tx, underlying_id, &option_instrument_ids, batch)
                .await?;
        let affected_rows = upsert_option_chain_latest_tx(
            &mut tx,
            underlying_id,
            provider,
            as_of,
            &option_contract_ids,
            batch,
        )
        .await?;
        if affected_rows != batch.len() as u64 {
            return Err(anyhow!(
                "option-chain persistence skipped a newer durable snapshot"
            ));
        }

        persisted += affected_rows as usize;
        if persisted < total {
            if throttle_ms > 0 {
                tokio::time::sleep(Duration::from_millis(throttle_ms)).await;
            } else {
                tokio::task::yield_now().await;
            }
        }
    }

    if let Some(job) = job {
        lock_job_attempt_tx(&mut tx, job).await?;
        record_option_chain_generation_tx(&mut tx, job, as_of, persisted).await?;
    }
    tx.commit().await?;
    Ok(persisted)
}

fn unique_option_chain_snapshots(
    snapshots: &[OptionChainSnapshot],
) -> Result<Vec<&OptionChainSnapshot>> {
    let mut by_ticker = BTreeMap::new();
    for snapshot in snapshots {
        if by_ticker
            .insert(snapshot.ticker.as_str(), snapshot)
            .is_some()
        {
            return Err(anyhow!(
                "duplicate option identity in option-chain snapshot"
            ));
        }
    }
    Ok(by_ticker.into_values().collect())
}

async fn ensure_instrument_tx(
    tx: &mut Transaction<'_, Postgres>,
    symbol: &str,
    asset_class: &str,
    underlying_symbol: Option<&str>,
) -> Result<Uuid> {
    sqlx::query(
        r#"
        insert into instruments (
          symbol,
          asset_class,
          name,
          currency,
          underlying_symbol,
          is_active,
          updated_at
        )
        values ($1, $2::asset_class, $1, 'USD', $3, true, now())
        on conflict (symbol) do nothing
        "#,
    )
    .bind(symbol)
    .bind(asset_class)
    .bind(underlying_symbol)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        update instruments
        set
          is_active = true,
          updated_at = now()
        where symbol = $1
          and asset_class = $2::asset_class
          and underlying_symbol is not distinct from $3
          and is_active is distinct from true
        "#,
    )
    .bind(symbol)
    .bind(asset_class)
    .bind(underlying_symbol)
    .execute(&mut **tx)
    .await?;

    let row = sqlx::query(
        r#"
        select id
        from instruments
        where symbol = $1
          and asset_class = $2::asset_class
          and underlying_symbol is not distinct from $3
        "#,
    )
    .bind(symbol)
    .bind(asset_class)
    .bind(underlying_symbol)
    .fetch_optional(&mut **tx)
    .await?;
    let row = row.ok_or_else(|| anyhow!("instrument identity collision"))?;
    Ok(row.try_get("id")?)
}

async fn ensure_option_instruments_tx(
    tx: &mut Transaction<'_, Postgres>,
    underlying_symbol: &str,
    snapshots: &[&OptionChainSnapshot],
) -> Result<HashMap<String, Uuid>> {
    if snapshots.is_empty() {
        return Ok(HashMap::new());
    }

    let symbols: Vec<&str> = snapshots
        .iter()
        .map(|snapshot| snapshot.ticker.as_str())
        .collect();
    let underlying_symbols = vec![underlying_symbol; symbols.len()];

    sqlx::query(
        r#"
        with input as (
          select symbol, underlying_symbol
          from unnest($1::text[], $2::text[]) as input(symbol, underlying_symbol)
        )
        insert into instruments (
          symbol,
          asset_class,
          name,
          currency,
          underlying_symbol,
          is_active,
          updated_at
        )
        select
          input.symbol,
          'option'::asset_class,
          input.symbol,
          'USD',
          input.underlying_symbol,
          true,
          now()
        from input
        on conflict (symbol) do nothing
        "#,
    )
    .bind(&symbols)
    .bind(&underlying_symbols)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        with input as (
          select symbol, underlying_symbol
          from unnest($1::text[], $2::text[]) as input(symbol, underlying_symbol)
        )
        update instruments
        set
          is_active = true,
          updated_at = now()
        from input
        where instruments.symbol = input.symbol
          and instruments.asset_class = 'option'::asset_class
          and instruments.underlying_symbol is not distinct from input.underlying_symbol
          and instruments.is_active is distinct from true
        "#,
    )
    .bind(&symbols)
    .bind(&underlying_symbols)
    .execute(&mut **tx)
    .await?;

    let rows = sqlx::query(
        r#"
        with input as (
          select symbol, underlying_symbol
          from unnest($1::text[], $2::text[]) as input(symbol, underlying_symbol)
        )
        select instruments.id, instruments.symbol
        from instruments
        join input on instruments.symbol = input.symbol
        where instruments.asset_class = 'option'::asset_class
          and instruments.underlying_symbol is not distinct from input.underlying_symbol
        "#,
    )
    .bind(&symbols)
    .bind(&underlying_symbols)
    .fetch_all(&mut **tx)
    .await?;
    if rows.len() != symbols.len() {
        return Err(anyhow!("instrument identity collision"));
    }

    rows.into_iter()
        .map(|row| {
            let symbol: String = row.try_get("symbol")?;
            let id: Uuid = row.try_get("id")?;
            Ok((symbol, id))
        })
        .collect()
}

async fn ensure_option_contracts_tx(
    tx: &mut Transaction<'_, Postgres>,
    underlying_instrument_id: Uuid,
    option_instrument_ids: &HashMap<String, Uuid>,
    snapshots: &[&OptionChainSnapshot],
) -> Result<HashMap<String, Uuid>> {
    if snapshots.is_empty() {
        return Ok(HashMap::new());
    }

    let mut instrument_ids = Vec::with_capacity(snapshots.len());
    let mut massive_tickers = Vec::with_capacity(snapshots.len());
    let mut expiration_dates = Vec::with_capacity(snapshots.len());
    let mut strikes = Vec::with_capacity(snapshots.len());
    let mut rights = Vec::with_capacity(snapshots.len());
    let mut shares_per_contract = Vec::with_capacity(snapshots.len());

    for snapshot in snapshots {
        instrument_ids.push(
            *option_instrument_ids
                .get(&snapshot.ticker)
                .with_context(|| format!("missing option instrument for {}", snapshot.ticker))?,
        );
        massive_tickers.push(snapshot.ticker.as_str());
        expiration_dates.push(parse_option_expiration(snapshot)?);
        strikes.push(snapshot.strike);
        rights.push(snapshot.right.as_str());
        shares_per_contract.push(snapshot.shares_per_contract);
    }

    sqlx::query(
        r#"
        with input as (
          select
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right,
            shares_per_contract
          from unnest(
            $1::uuid[],
            $2::text[],
            $3::date[],
            $4::float8[],
            $5::text[],
            $6::int4[]
          ) as input(
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right,
            shares_per_contract
          )
        )
        insert into option_contracts (
          instrument_id,
          underlying_instrument_id,
          massive_ticker,
          provider_contract_id,
          expiration_date,
          strike,
          "right",
          multiplier,
          shares_per_contract,
          is_active,
          updated_at
        )
        select
          input.option_instrument_id,
          $7::uuid,
          input.massive_ticker,
          null,
          input.expiration_date,
          input.strike,
          input.contract_right::option_right,
          100,
          input.shares_per_contract,
          true,
          now()
        from input
        on conflict (massive_ticker) do nothing
        "#,
    )
    .bind(&instrument_ids)
    .bind(&massive_tickers)
    .bind(&expiration_dates)
    .bind(&strikes)
    .bind(&rights)
    .bind(&shares_per_contract)
    .bind(underlying_instrument_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        with input as (
          select
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right,
            shares_per_contract
          from unnest(
            $1::uuid[],
            $2::text[],
            $3::date[],
            $4::float8[],
            $5::text[],
            $6::int4[]
          ) as input(
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right,
            shares_per_contract
          )
        )
        update option_contracts
        set
          multiplier = 100,
          shares_per_contract = input.shares_per_contract,
          is_active = true,
          updated_at = now()
        from input
        where option_contracts.massive_ticker = input.massive_ticker
          and option_contracts.instrument_id = input.option_instrument_id
          and option_contracts.underlying_instrument_id = $7::uuid
          and option_contracts.expiration_date = input.expiration_date
          and option_contracts.strike::float8 is not distinct from input.strike
          and option_contracts."right" = input.contract_right::option_right
          and (
            option_contracts.multiplier is distinct from 100
            or option_contracts.shares_per_contract is distinct from input.shares_per_contract
            or option_contracts.is_active is distinct from true
          )
        "#,
    )
    .bind(&instrument_ids)
    .bind(&massive_tickers)
    .bind(&expiration_dates)
    .bind(&strikes)
    .bind(&rights)
    .bind(&shares_per_contract)
    .bind(underlying_instrument_id)
    .execute(&mut **tx)
    .await?;

    let rows = sqlx::query(
        r#"
        with input as (
          select
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right
          from unnest(
            $1::uuid[],
            $2::text[],
            $3::date[],
            $4::float8[],
            $5::text[]
          ) as input(
            option_instrument_id,
            massive_ticker,
            expiration_date,
            strike,
            contract_right
          )
        )
        select option_contracts.id, option_contracts.massive_ticker
        from option_contracts
        join input on option_contracts.massive_ticker = input.massive_ticker
        where option_contracts.instrument_id = input.option_instrument_id
          and option_contracts.underlying_instrument_id = $6::uuid
          and option_contracts.expiration_date = input.expiration_date
          and option_contracts.strike::float8 is not distinct from input.strike
          and option_contracts."right" = input.contract_right::option_right
        "#,
    )
    .bind(&instrument_ids)
    .bind(&massive_tickers)
    .bind(&expiration_dates)
    .bind(&strikes)
    .bind(&rights)
    .bind(underlying_instrument_id)
    .fetch_all(&mut **tx)
    .await?;
    if rows.len() != massive_tickers.len() {
        return Err(anyhow!("option contract identity collision"));
    }

    rows.into_iter()
        .map(|row| {
            let ticker: String = row.try_get("massive_ticker")?;
            let id: Uuid = row.try_get("id")?;
            Ok((ticker, id))
        })
        .collect()
}

async fn upsert_option_chain_latest_tx(
    tx: &mut Transaction<'_, Postgres>,
    underlying_instrument_id: Uuid,
    provider: &str,
    as_of: DateTime<Utc>,
    option_contract_ids: &HashMap<String, Uuid>,
    snapshots: &[&OptionChainSnapshot],
) -> Result<u64> {
    if snapshots.is_empty() {
        return Ok(0);
    }

    let mut contract_ids = Vec::with_capacity(snapshots.len());
    let mut bids = Vec::with_capacity(snapshots.len());
    let mut asks = Vec::with_capacity(snapshots.len());
    let mut lasts = Vec::with_capacity(snapshots.len());
    let mut marks = Vec::with_capacity(snapshots.len());
    let mut implied_volatilities = Vec::with_capacity(snapshots.len());
    let mut deltas = Vec::with_capacity(snapshots.len());
    let mut gammas = Vec::with_capacity(snapshots.len());
    let mut thetas = Vec::with_capacity(snapshots.len());
    let mut vegas = Vec::with_capacity(snapshots.len());
    let mut open_interests = Vec::with_capacity(snapshots.len());
    let mut volumes = Vec::with_capacity(snapshots.len());

    for snapshot in snapshots {
        contract_ids.push(
            *option_contract_ids
                .get(&snapshot.ticker)
                .with_context(|| format!("missing option contract for {}", snapshot.ticker))?,
        );
        bids.push(snapshot.bid);
        asks.push(snapshot.ask);
        lasts.push(snapshot.last);
        marks.push(snapshot.mark);
        implied_volatilities.push(snapshot.implied_volatility);
        deltas.push(snapshot.delta);
        gammas.push(snapshot.gamma);
        thetas.push(snapshot.theta);
        vegas.push(snapshot.vega);
        open_interests.push(snapshot.open_interest);
        volumes.push(snapshot.volume);
    }

    // One latest row per (contract, source). This replaces the old append-only
    // option_chain_snapshots write path that saturated the shared Postgres I/O.
    // The monotonicity guard keeps an out-of-order/older fetch from regressing a
    // fresher row.
    let result = sqlx::query(
        r#"
        with input as (
          select
            option_contract_id,
            bid,
            ask,
            last,
            mark,
            implied_volatility,
            delta,
            gamma,
            theta,
            vega,
            open_interest,
            volume
          from unnest(
            $2::uuid[],
            $3::float8[],
            $4::float8[],
            $5::float8[],
            $6::float8[],
            $7::float8[],
            $8::float8[],
            $9::float8[],
            $10::float8[],
            $11::float8[],
            $12::int4[],
            $13::int4[]
          ) as input(
            option_contract_id,
            bid,
            ask,
            last,
            mark,
            implied_volatility,
            delta,
            gamma,
            theta,
            vega,
            open_interest,
            volume
          )
        )
        insert into option_chain_latest (
          underlying_instrument_id,
          option_contract_id,
          bid,
          ask,
          last,
          mark,
          implied_volatility,
          delta,
          gamma,
          theta,
          vega,
          open_interest,
          volume,
          source,
          as_of,
          updated_at
        )
        select
          $1::uuid,
          input.option_contract_id,
          input.bid,
          input.ask,
          input.last,
          input.mark,
          input.implied_volatility,
          input.delta,
          input.gamma,
          input.theta,
          input.vega,
          input.open_interest,
          input.volume,
          $14,
          $15,
          now()
        from input
        on conflict (option_contract_id, source) do update set
          bid = excluded.bid,
          ask = excluded.ask,
          last = excluded.last,
          mark = excluded.mark,
          implied_volatility = excluded.implied_volatility,
          delta = excluded.delta,
          gamma = excluded.gamma,
          theta = excluded.theta,
          vega = excluded.vega,
          open_interest = excluded.open_interest,
          volume = excluded.volume,
          as_of = excluded.as_of,
          updated_at = now()
        where excluded.as_of >= option_chain_latest.as_of
        "#,
    )
    .bind(underlying_instrument_id)
    .bind(&contract_ids)
    .bind(&bids)
    .bind(&asks)
    .bind(&lasts)
    .bind(&marks)
    .bind(&implied_volatilities)
    .bind(&deltas)
    .bind(&gammas)
    .bind(&thetas)
    .bind(&vegas)
    .bind(&open_interests)
    .bind(&volumes)
    .bind(provider)
    .bind(as_of)
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected())
}

fn parse_option_expiration(snapshot: &OptionChainSnapshot) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(&snapshot.expiration_date, "%Y-%m-%d")
        .with_context(|| format!("invalid expiration date for {}", snapshot.ticker))
}

#[cfg(test)]
mod tests {
    #[test]
    fn option_chain_persistence_uses_database_time_and_fails_skipped_writes() {
        let source = include_str!("ingest.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        assert!(!source.contains("let as_of = utc::now()"));
        assert!(source.contains("select now()"));
        assert!(source.contains("rows_affected()"));
        assert!(source.contains("option-chain persistence skipped"));
        assert!(source.contains("duplicate option identity"));
        assert!(source.contains("record_option_chain_generation_tx"));
    }

    #[test]
    fn option_chain_persistence_rejects_immutable_identity_collisions() {
        let source = include_str!("ingest.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        for rewrite in [
            "set asset_class =",
            "underlying_symbol = coalesce",
            "set instrument_id =",
            "underlying_instrument_id = $7::uuid,",
            "expiration_date = input.expiration_date,",
            "strike = input.strike,",
            "\"right\" = input.contract_right::option_right,",
        ] {
            assert!(!source.contains(rewrite), "{rewrite}");
        }
        for fence in [
            "and asset_class = $2::asset_class",
            "and underlying_symbol is not distinct from $3",
            "and instruments.asset_class = 'option'::asset_class",
            "and instruments.underlying_symbol is not distinct from input.underlying_symbol",
            "and option_contracts.instrument_id = input.option_instrument_id",
            "and option_contracts.underlying_instrument_id = $7::uuid",
            "and option_contracts.expiration_date = input.expiration_date",
            "and option_contracts.strike::float8 is not distinct from input.strike",
            "and option_contracts.\"right\" = input.contract_right::option_right",
        ] {
            assert!(source.contains(fence), "{fence}");
        }
        assert!(source.contains("instrument identity collision"));
        assert!(source.contains("option contract identity collision"));
    }
}
