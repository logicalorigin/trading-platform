use std::collections::{BTreeMap, HashMap};

use anyhow::{Context, Result};
use chrono::{DateTime, NaiveDate, Utc};
use serde_json::Value;
use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, Row, Transaction};

use crate::providers::massive::{OptionChainSnapshot, StockSnapshot};

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

pub async fn persist_stock_snapshot(
    pool: &PgPool,
    symbol: &str,
    provider: &str,
    snapshot: &StockSnapshot,
) -> Result<()> {
    let symbol = symbol.trim().to_uppercase();
    let instrument_id = ensure_instrument(pool, &symbol, "equity", None).await?;

    sqlx::query(
        r#"
        insert into quote_cache (
          instrument_id,
          symbol,
          bid,
          ask,
          last,
          bid_size,
          ask_size,
          last_size,
          change,
          change_percent,
          source,
          as_of,
          updated_at
        )
        values (
          $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11, $12, now()
        )
        "#,
    )
    .bind(&instrument_id)
    .bind(&symbol)
    .bind(snapshot.bid)
    .bind(snapshot.ask)
    .bind(snapshot.last)
    .bind(snapshot.bid_size)
    .bind(snapshot.ask_size)
    .bind(snapshot.last_size)
    .bind(snapshot.change)
    .bind(snapshot.change_percent)
    .bind(provider)
    .bind(snapshot.as_of)
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

    let mut tx = pool.begin().await?;
    let underlying_id = ensure_instrument_tx(&mut tx, &symbol, "equity", None).await?;
    let option_instrument_ids =
        ensure_option_instruments_tx(&mut tx, &symbol, &unique_snapshots).await?;
    let option_contract_ids = ensure_option_contracts_tx(
        &mut tx,
        underlying_id,
        &option_instrument_ids,
        &unique_snapshots,
    )
    .await?;
    insert_option_chain_snapshots_tx(
        &mut tx,
        underlying_id,
        provider,
        as_of,
        &option_contract_ids,
        &unique_snapshots,
    )
    .await?;
    tx.commit().await?;

    Ok(unique_snapshots.len())
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

async fn ensure_instrument(
    pool: &PgPool,
    symbol: &str,
    asset_class: &str,
    underlying_symbol: Option<&str>,
) -> Result<String> {
    let row = sqlx::query(
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
        on conflict (symbol) do update
        set
          asset_class = excluded.asset_class,
          underlying_symbol = coalesce(excluded.underlying_symbol, instruments.underlying_symbol),
          updated_at = now()
        returning id::text as id
        "#,
    )
    .bind(symbol)
    .bind(asset_class)
    .bind(underlying_symbol)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("id")?)
}

async fn ensure_instrument_tx(
    tx: &mut Transaction<'_, Postgres>,
    symbol: &str,
    asset_class: &str,
    underlying_symbol: Option<&str>,
) -> Result<Uuid> {
    let row = sqlx::query(
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
        on conflict (symbol) do update
        set
          asset_class = excluded.asset_class,
          underlying_symbol = coalesce(excluded.underlying_symbol, instruments.underlying_symbol),
          updated_at = now()
        returning id
        "#,
    )
    .bind(symbol)
    .bind(asset_class)
    .bind(underlying_symbol)
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

    let rows = sqlx::query(
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
        on conflict (symbol) do update
        set
          asset_class = excluded.asset_class,
          underlying_symbol = coalesce(excluded.underlying_symbol, instruments.underlying_symbol),
          is_active = true,
          updated_at = now()
        returning id, symbol
        "#,
    )
    .bind(&symbols)
    .bind(&underlying_symbols)
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

    let rows = sqlx::query(
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
        on conflict (massive_ticker) do update
        set
          expiration_date = excluded.expiration_date,
          strike = excluded.strike,
          "right" = excluded."right",
          multiplier = excluded.multiplier,
          shares_per_contract = excluded.shares_per_contract,
          is_active = true,
          updated_at = now()
        returning id, massive_ticker
        "#,
    )
    .bind(&instrument_ids)
    .bind(&massive_tickers)
    .bind(&expiration_dates)
    .bind(&strikes)
    .bind(&rights)
    .bind(&shares_per_contract)
    .bind(underlying_instrument_id)
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

async fn insert_option_chain_snapshots_tx(
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
        insert into option_chain_snapshots (
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

#[cfg(test)]
mod tests {
    use super::*;

    fn option_snapshot(ticker: &str, bid: Option<f64>) -> OptionChainSnapshot {
        OptionChainSnapshot {
            ticker: ticker.to_string(),
            expiration_date: "2026-05-15".to_string(),
            strike: 100.0,
            right: "call".to_string(),
            shares_per_contract: 100,
            bid,
            ask: Some(1.2),
            last: Some(1.1),
            mark: Some(1.1),
            implied_volatility: Some(0.2),
            delta: Some(0.5),
            gamma: Some(0.02),
            theta: None,
            vega: None,
            open_interest: Some(25),
            volume: Some(10),
        }
    }

    #[test]
    fn unique_option_chain_snapshots_keeps_last_snapshot_per_ticker() {
        let snapshots = vec![
            option_snapshot("O:SPY260515C00100000", Some(1.0)),
            option_snapshot("O:SPY260515P00100000", Some(2.0)),
            option_snapshot("O:SPY260515C00100000", Some(1.5)),
        ];

        let unique = unique_option_chain_snapshots(&snapshots);

        assert_eq!(unique.len(), 2);
        assert_eq!(unique[0].ticker, "O:SPY260515C00100000");
        assert_eq!(unique[0].bid, Some(1.5));
        assert_eq!(unique[1].ticker, "O:SPY260515P00100000");
    }

    #[test]
    fn parse_option_expiration_rejects_invalid_dates() {
        let snapshot = OptionChainSnapshot {
            expiration_date: "bad-date".to_string(),
            ..option_snapshot("O:SPY260515C00100000", Some(1.0))
        };

        let error = parse_option_expiration(&snapshot).unwrap_err();
        assert!(error.to_string().contains("invalid expiration date"));
    }
}
