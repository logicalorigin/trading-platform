use anyhow::Result;
use chrono::Utc;
use sqlx::{PgPool, Row};

use crate::providers::polygon::OptionChainSnapshot;

pub async fn persist_option_chain_snapshots(
    pool: &PgPool,
    underlying: &str,
    provider: &str,
    snapshots: &[OptionChainSnapshot],
) -> Result<usize> {
    let symbol = underlying.trim().to_uppercase();
    let underlying_id = ensure_instrument(pool, &symbol, "equity", None).await?;
    let as_of = Utc::now();
    let mut persisted = 0usize;

    for snapshot in snapshots {
        let option_instrument_id = ensure_instrument(
            pool,
            &snapshot.ticker,
            "option",
            Some(&symbol),
        )
        .await?;
        let contract_id = ensure_option_contract(
            pool,
            &option_instrument_id,
            &underlying_id,
            snapshot,
        )
        .await?;

        sqlx::query(
            r#"
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
            values (
              $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
              $11, $12, $13, $14, $15, now()
            )
            "#,
        )
        .bind(&underlying_id)
        .bind(&contract_id)
        .bind(snapshot.bid)
        .bind(snapshot.ask)
        .bind(snapshot.last)
        .bind(snapshot.mark)
        .bind(snapshot.implied_volatility)
        .bind(snapshot.delta)
        .bind(snapshot.gamma)
        .bind(snapshot.theta)
        .bind(snapshot.vega)
        .bind(snapshot.open_interest)
        .bind(snapshot.volume)
        .bind(provider)
        .bind(as_of)
        .execute(pool)
        .await?;
        persisted += 1;
    }

    Ok(persisted)
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

async fn ensure_option_contract(
    pool: &PgPool,
    option_instrument_id: &str,
    underlying_instrument_id: &str,
    snapshot: &OptionChainSnapshot,
) -> Result<String> {
    let row = sqlx::query(
        r#"
        insert into option_contracts (
          instrument_id,
          underlying_instrument_id,
          polygon_ticker,
          provider_contract_id,
          expiration_date,
          strike,
          right,
          multiplier,
          shares_per_contract,
          is_active,
          updated_at
        )
        values (
          $1::uuid,
          $2::uuid,
          $3,
          null,
          $4::date,
          $5,
          $6::option_right,
          $7,
          $7,
          true,
          now()
        )
        on conflict (polygon_ticker) do update
        set
          expiration_date = excluded.expiration_date,
          strike = excluded.strike,
          right = excluded.right,
          multiplier = excluded.multiplier,
          shares_per_contract = excluded.shares_per_contract,
          is_active = true,
          updated_at = now()
        returning id::text as id
        "#,
    )
    .bind(option_instrument_id)
    .bind(underlying_instrument_id)
    .bind(&snapshot.ticker)
    .bind(&snapshot.expiration_date)
    .bind(snapshot.strike)
    .bind(&snapshot.right)
    .bind(snapshot.shares_per_contract)
    .fetch_one(pool)
    .await?;
    Ok(row.try_get("id")?)
}
