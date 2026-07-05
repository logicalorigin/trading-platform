use std::collections::{BTreeMap, HashMap};
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Row, Transaction};

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
) -> Result<usize> {
    let symbol = underlying.trim().to_uppercase();
    let unique_snapshots = unique_option_chain_snapshots(snapshots);
    let as_of = Utc::now();
    let batch_size = option_chain_write_batch_size();
    let throttle_ms = option_chain_write_throttle_ms();
    let total = unique_snapshots.len();
    let mut persisted = 0usize;

    let mut tx = pool.begin().await?;
    let underlying_id = ensure_instrument_tx(&mut tx, &symbol, "equity", None).await?;
    tx.commit().await?;

    for batch in unique_snapshots.chunks(batch_size) {
        let mut tx = pool.begin().await?;
        let option_instrument_ids = ensure_option_instruments_tx(&mut tx, &symbol, batch).await?;
        let option_contract_ids =
            ensure_option_contracts_tx(&mut tx, underlying_id, &option_instrument_ids, batch)
                .await?;
        upsert_option_chain_latest_tx(
            &mut tx,
            underlying_id,
            provider,
            as_of,
            &option_contract_ids,
            batch,
        )
        .await?;
        tx.commit().await?;

        persisted += batch.len();
        if persisted < total {
            if throttle_ms > 0 {
                tokio::time::sleep(Duration::from_millis(throttle_ms)).await;
            } else {
                tokio::task::yield_now().await;
            }
        }
    }

    Ok(persisted)
}

fn unique_option_chain_snapshots(snapshots: &[OptionChainSnapshot]) -> Vec<&OptionChainSnapshot> {
    snapshots
        .iter()
        .fold(BTreeMap::new(), |mut by_ticker, snapshot| {
            by_ticker.insert(snapshot.ticker.as_str(), snapshot);
            by_ticker
        })
        .into_values()
        .collect()
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
          asset_class = $2::asset_class,
          underlying_symbol = coalesce($3, underlying_symbol),
          is_active = true,
          updated_at = now()
        where symbol = $1
          and (
            asset_class is distinct from $2::asset_class
            or ($3 is not null and underlying_symbol is distinct from $3)
            or is_active is distinct from true
          )
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
        "#,
    )
    .bind(symbol)
    .fetch_one(&mut **tx)
    .await?;
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
          asset_class = 'option'::asset_class,
          underlying_symbol = coalesce(input.underlying_symbol, instruments.underlying_symbol),
          is_active = true,
          updated_at = now()
        from input
        where instruments.symbol = input.symbol
          and (
            instruments.asset_class is distinct from 'option'::asset_class
            or (
              input.underlying_symbol is not null
              and instruments.underlying_symbol is distinct from input.underlying_symbol
            )
            or instruments.is_active is distinct from true
          )
        "#,
    )
    .bind(&symbols)
    .bind(&underlying_symbols)
    .execute(&mut **tx)
    .await?;

    let rows = sqlx::query(
        r#"
        select id, symbol
        from instruments
        where symbol = any($1::text[])
        "#,
    )
    .bind(&symbols)
    .fetch_all(&mut **tx)
    .await?;

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
          input.shares_per_contract,
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
          instrument_id = input.option_instrument_id,
          underlying_instrument_id = $7::uuid,
          expiration_date = input.expiration_date,
          strike = input.strike,
          "right" = input.contract_right::option_right,
          multiplier = input.shares_per_contract,
          shares_per_contract = input.shares_per_contract,
          is_active = true,
          updated_at = now()
        from input
        where option_contracts.massive_ticker = input.massive_ticker
          and (
            option_contracts.instrument_id is distinct from input.option_instrument_id
            or option_contracts.underlying_instrument_id is distinct from $7::uuid
            or option_contracts.expiration_date is distinct from input.expiration_date
            or option_contracts.strike::float8 is distinct from input.strike
            or option_contracts."right" is distinct from input.contract_right::option_right
            or option_contracts.multiplier is distinct from input.shares_per_contract
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
        select id, massive_ticker
        from option_contracts
        where massive_ticker = any($1::text[])
        "#,
    )
    .bind(&massive_tickers)
    .fetch_all(&mut **tx)
    .await?;

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
) -> Result<()> {
    if snapshots.is_empty() {
        return Ok(());
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
    sqlx::query(
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

    Ok(())
}

fn parse_option_expiration(snapshot: &OptionChainSnapshot) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(&snapshot.expiration_date, "%Y-%m-%d")
        .with_context(|| format!("invalid expiration date for {}", snapshot.ticker))
}
