use anyhow::{anyhow, Result};
use chrono::{DateTime, Datelike, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{PgPool, Postgres, Row, Transaction};
use std::collections::BTreeSet;

use crate::jobs::{
    lock_gex_prerequisite_tx, lock_job_attempt_tx, IngestJob, OptionChainGeneration,
};

/// Maximum age (in seconds) of the underlying spot/chain data before the GEX
/// snapshot is considered stale. There is no existing freshness threshold in
/// this crate, so we pick a conservative default for a live trading UI.
/// Worker-side ingest staleness gate; intentionally differs from the API's
/// serve-gate (60s, `gex.ts` `GEX_SNAPSHOT_MAX_AGE_MS`) and the live-recompute
/// `isStale` threshold (15min).
const GEX_STALE_AFTER_SECS: i64 = 120;
const NUMERIC_18_6_ABS_LIMIT: f64 = 1_000_000_000_000.0;
const NUMERIC_24_6_ABS_LIMIT: f64 = 1_000_000_000_000_000_000.0;

/// Derive whether the data backing this GEX snapshot is stale based on the age
/// of the spot quote and the option chain. If either age cannot be determined
/// (e.g. the chain has no timestamps), we mark it stale rather than fabricating
/// freshness we cannot confirm.
fn is_gex_data_stale(
    computed_at: DateTime<Utc>,
    spot_as_of: DateTime<Utc>,
    chain_updated_at: Option<DateTime<Utc>>,
) -> bool {
    let chain_updated_at = match chain_updated_at {
        Some(value) => value,
        None => return true,
    };
    let maximum_age = chrono::Duration::seconds(GEX_STALE_AFTER_SECS);
    [spot_as_of, chain_updated_at].into_iter().any(|as_of| {
        let age = computed_at.signed_duration_since(as_of);
        age < chrono::Duration::zero() || age > maximum_age
    })
}

fn ensure_gex_inputs_fresh(
    computed_at: DateTime<Utc>,
    spot_as_of: DateTime<Utc>,
    chain_updated_at: Option<DateTime<Utc>>,
) -> Result<()> {
    if is_gex_data_stale(computed_at, spot_as_of, chain_updated_at) {
        return Err(anyhow!("GEX inputs are stale"));
    }
    Ok(())
}

fn ensure_option_chain_generation_complete(expected: usize, actual: usize) -> Result<()> {
    if actual != expected {
        return Err(anyhow!(
            "option-chain generation was partly overwritten before GEX computation"
        ));
    }
    Ok(())
}

const LOAD_LATEST_OPTION_GENERATION_SQL: &str = r#"
with underlying as (
    select id
    from instruments
    where symbol = $1
    limit 1
),
latest_chain as (
    select max(snap.as_of) as as_of
    from option_chain_latest snap
    join underlying
      on underlying.id = snap.underlying_instrument_id
    where snap.source = 'massive'
)
select
    latest_chain.as_of,
    count(snap.option_contract_id)::bigint as option_count
from latest_chain
join underlying
  on latest_chain.as_of is not null
join option_chain_latest snap
  on snap.underlying_instrument_id = underlying.id
 and snap.source = 'massive'
 and snap.as_of = latest_chain.as_of
group by latest_chain.as_of
"#;

const LOAD_LATEST_OPTION_SNAPSHOTS_SQL: &str = r#"
with underlying as (
    select id
    from instruments
    where symbol = $1
    limit 1
),
exact_chain as materialized (
    select snap.*
    from option_chain_latest snap
    join underlying
      on underlying.id = snap.underlying_instrument_id
    where snap.source = 'massive'
      and snap.as_of = $2
)
select
    snap.option_contract_id,
    snap.bid::float8 as bid,
    snap.ask::float8 as ask,
    snap.mark::float8 as mark,
    snap.implied_volatility::float8 as implied_volatility,
    snap.delta::float8 as delta,
    snap.gamma::float8 as gamma,
    snap.theta::float8 as theta,
    snap.vega::float8 as vega,
    snap.open_interest::float8 as open_interest,
    snap.volume::float8 as volume,
    snap.source,
    snap.as_of,
    contract.massive_ticker,
    contract.provider_contract_id,
    contract.expiration_date::text as expiration_date,
    contract.strike::float8 as strike,
    contract."right"::text as right,
    100 as multiplier,
    contract.shares_per_contract,
    (select count(*)::bigint from exact_chain) as raw_option_count
from underlying
join option_contracts contract
  on contract.underlying_instrument_id = underlying.id
join exact_chain snap
  on snap.option_contract_id = contract.id
 and snap.underlying_instrument_id = underlying.id
where contract.is_active = true
  and contract.expiration_date >= current_date
order by contract.expiration_date asc, contract.strike asc
		"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum OptionRight {
    Call,
    Put,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GexContract {
    pub ticker: Option<String>,
    pub underlying: String,
    pub provider_contract_id: Option<String>,
    pub expiration_date: String,
    pub strike: f64,
    pub right: OptionRight,
    pub gamma: Option<f64>,
    pub delta: Option<f64>,
    pub theta: Option<f64>,
    pub vega: Option<f64>,
    pub open_interest: Option<f64>,
    pub implied_volatility: Option<f64>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub mark: Option<f64>,
    pub multiplier: f64,
    pub shares_per_contract: f64,
    pub volume: Option<f64>,
    pub source: String,
    pub updated_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq)]
struct SpotQuote {
    spot: f64,
    change: Option<f64>,
    source: String,
    as_of: chrono::DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GexSummary {
    pub symbol: String,
    pub spot: f64,
    pub net_gex: f64,
    pub option_count: usize,
    pub usable_option_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GexExpirationCoverage {
    requested_count: usize,
    returned_count: usize,
    loaded_count: usize,
    failed_count: usize,
    complete: bool,
    capped: bool,
}

fn try_contract_gex(contract: &GexContract, spot: f64) -> Result<Option<f64>> {
    let (Some(gamma), Some(open_interest)) = (contract.gamma, contract.open_interest) else {
        return Ok(None);
    };
    if !(spot > 0.0
        && spot.is_finite()
        && gamma.is_finite()
        && gamma >= 0.0
        && open_interest.is_finite()
        && open_interest >= 0.0
        && contract.multiplier.is_finite()
        && contract.multiplier > 0.0)
    {
        return Err(anyhow!("invalid numeric input for GEX contract"));
    }
    let sign = match contract.right {
        OptionRight::Call => 1.0,
        OptionRight::Put => -1.0,
    };
    // Approximate dollar gamma exposure for a 1% underlying move.
    let value = sign * gamma * open_interest * contract.multiplier * spot * spot * 0.01;
    if !value.is_finite() || value.abs() >= NUMERIC_24_6_ABS_LIMIT {
        return Err(anyhow!("GEX contract exceeds numeric(24,6) range"));
    }
    Ok(Some(value))
}

pub fn contract_gex(contract: &GexContract, spot: f64) -> Option<f64> {
    try_contract_gex(contract, spot).ok().flatten()
}

pub fn summarize_gex(symbol: &str, spot: f64, contracts: &[GexContract]) -> Result<GexSummary> {
    let mut net_gex = 0.0;
    let mut compensation = 0.0;
    let mut usable_option_count = 0;
    for contract in contracts {
        if let Some(value) = try_contract_gex(contract, spot)? {
            let next_net_gex = net_gex + value;
            compensation += if net_gex.abs() >= value.abs() {
                (net_gex - next_net_gex) + value
            } else {
                (value - next_net_gex) + net_gex
            };
            let compensated_total = next_net_gex + compensation;
            if !compensated_total.is_finite() || compensated_total.abs() >= NUMERIC_24_6_ABS_LIMIT {
                return Err(anyhow!("aggregate GEX exceeds numeric(24,6) range"));
            }
            net_gex = next_net_gex;
            usable_option_count += 1;
        }
    }
    net_gex += compensation;
    Ok(GexSummary {
        symbol: symbol.to_string(),
        spot,
        net_gex,
        option_count: contracts.len(),
        usable_option_count,
    })
}

pub async fn compute_and_persist_gex_snapshot(
    pool: &PgPool,
    symbol_input: &str,
    job: Option<&IngestJob>,
) -> Result<GexSummary> {
    let symbol = symbol_input.trim().to_uppercase();
    if symbol.is_empty() {
        return Err(anyhow!("symbol is required"));
    }

    let mut tx = pool.begin().await?;
    let prerequisite_generation = if let Some(job) = job {
        let generation = lock_gex_prerequisite_tx(&mut tx, job).await?;
        lock_job_attempt_tx(&mut tx, job).await?;
        generation
    } else {
        None
    };
    let generation = match prerequisite_generation {
        Some(generation) => generation,
        None => load_latest_option_generation(&mut tx, &symbol).await?,
    };
    let computed_at = sqlx::query_scalar::<_, DateTime<Utc>>("select now()")
        .fetch_one(&mut *tx)
        .await?;
    let spot_quote = load_latest_spot(&mut tx, &symbol).await?;
    let expected_option_count = generation.option_count;
    let (contracts, raw_option_count) =
        load_latest_option_snapshots(&mut tx, &symbol, generation.as_of).await?;
    ensure_option_chain_generation_complete(expected_option_count, raw_option_count)?;
    if contracts.is_empty() {
        return Err(anyhow!("no option-chain snapshots found for {symbol}"));
    }

    ensure_gex_inputs_fresh(
        computed_at,
        spot_quote.as_of,
        oldest_contract_timestamp(&contracts),
    )?;
    let summary = summarize_gex(&symbol, spot_quote.spot, &contracts)?;
    if summary.usable_option_count == 0 {
        return Err(anyhow!("no usable option contracts found for {symbol}"));
    }

    let source_status = if summary.usable_option_count < summary.option_count {
        "partial"
    } else {
        "ok"
    };
    let source_message = if source_status == "partial" {
        Some("GEX snapshot excludes contracts missing gamma or open interest.")
    } else {
        None
    };
    let payload = build_gex_payload(
        &summary,
        &contracts,
        &spot_quote,
        computed_at,
        source_status,
        source_message,
    );

    sqlx::query(
        r#"
        insert into gex_snapshots (
          symbol,
          computed_at,
          spot,
          net_gex,
          option_count,
          usable_option_count,
          source_status,
          source_message,
          payload,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
        on conflict (symbol, computed_at) do update
        set
          spot = excluded.spot,
          net_gex = excluded.net_gex,
          option_count = excluded.option_count,
          usable_option_count = excluded.usable_option_count,
          source_status = excluded.source_status,
          source_message = excluded.source_message,
          payload = excluded.payload,
          updated_at = now()
        "#,
    )
    .bind(&summary.symbol)
    .bind(computed_at)
    .bind(summary.spot)
    .bind(summary.net_gex)
    .bind(summary.option_count as i32)
    .bind(summary.usable_option_count as i32)
    .bind(source_status)
    .bind(source_message)
    .bind(payload)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(summary)
}

async fn load_latest_spot(tx: &mut Transaction<'_, Postgres>, symbol: &str) -> Result<SpotQuote> {
    let row = sqlx::query(
        r#"
        select
          last::float8 as spot,
          change::float8 as change,
          source,
          as_of
        from quote_cache
        where symbol = $1 and last is not null
        order by as_of desc
        limit 1
        "#,
    )
    .bind(symbol)
    .fetch_optional(&mut **tx)
    .await?;
    let row = row.ok_or_else(|| anyhow!("no latest spot quote found for {symbol}"))?;
    let spot = row
        .try_get::<Option<f64>, _>("spot")?
        .ok_or_else(|| anyhow!("no latest spot quote found for {symbol}"))?;
    if spot <= 0.0 || !spot.is_finite() || spot >= NUMERIC_18_6_ABS_LIMIT {
        return Err(anyhow!("latest spot quote is invalid for {symbol}"));
    }
    Ok(SpotQuote {
        spot,
        change: row.try_get("change")?,
        source: row.try_get("source")?,
        as_of: row.try_get("as_of")?,
    })
}

async fn load_latest_option_generation(
    tx: &mut Transaction<'_, Postgres>,
    symbol: &str,
) -> Result<OptionChainGeneration> {
    let row = sqlx::query(LOAD_LATEST_OPTION_GENERATION_SQL)
        .bind(symbol)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or_else(|| anyhow!("no option-chain snapshots found for {symbol}"))?;
    let option_count: i64 = row.try_get("option_count")?;
    let option_count = usize::try_from(option_count)
        .map_err(|_| anyhow!("latest option-chain generation count is invalid"))?;
    Ok(OptionChainGeneration {
        as_of: row.try_get("as_of")?,
        option_count,
    })
}

async fn load_latest_option_snapshots(
    tx: &mut Transaction<'_, Postgres>,
    symbol: &str,
    generation_as_of: DateTime<Utc>,
) -> Result<(Vec<GexContract>, usize)> {
    let rows = sqlx::query(LOAD_LATEST_OPTION_SNAPSHOTS_SQL)
        .bind(symbol)
        .bind(generation_as_of)
        .fetch_all(&mut **tx)
        .await?;
    let raw_option_count = rows
        .first()
        .map(|row| row.try_get::<i64, _>("raw_option_count"))
        .transpose()?
        .unwrap_or(0);
    let raw_option_count = usize::try_from(raw_option_count)
        .map_err(|_| anyhow!("option-chain generation count is invalid"))?;

    let contracts = rows
        .into_iter()
        .map(|row| {
            let right_raw: String = row.try_get("right")?;
            let right = match right_raw.as_str() {
                "call" => OptionRight::Call,
                "put" => OptionRight::Put,
                _ => return Err(anyhow!("unsupported option right {right_raw}")),
            };
            Ok(GexContract {
                ticker: row.try_get("massive_ticker")?,
                underlying: symbol.to_string(),
                provider_contract_id: row.try_get("provider_contract_id")?,
                expiration_date: row.try_get("expiration_date")?,
                strike: row.try_get("strike")?,
                right,
                gamma: row.try_get("gamma")?,
                delta: row.try_get("delta")?,
                theta: row.try_get("theta")?,
                vega: row.try_get("vega")?,
                open_interest: row.try_get("open_interest")?,
                implied_volatility: row.try_get("implied_volatility")?,
                bid: row.try_get("bid")?,
                ask: row.try_get("ask")?,
                mark: row.try_get("mark")?,
                multiplier: row.try_get::<i32, _>("multiplier")? as f64,
                shares_per_contract: row.try_get::<i32, _>("shares_per_contract")? as f64,
                volume: row.try_get("volume")?,
                source: row.try_get("source")?,
                updated_at: row.try_get("as_of")?,
            })
        })
        .collect::<Result<Vec<_>>>()?;
    Ok((contracts, raw_option_count))
}

fn build_expiration_coverage(
    contracts: &[GexContract],
    spot: f64,
    source_status: &str,
) -> GexExpirationCoverage {
    let requested_expirations: BTreeSet<&str> = contracts
        .iter()
        .map(|contract| contract.expiration_date.trim())
        .filter(|expiration_date| !expiration_date.is_empty())
        .collect();
    let loaded_expirations: BTreeSet<&str> = contracts
        .iter()
        .filter(|contract| contract_gex(contract, spot).is_some())
        .map(|contract| contract.expiration_date.trim())
        .filter(|expiration_date| !expiration_date.is_empty())
        .collect();
    let requested_count = requested_expirations.len();
    let loaded_count = loaded_expirations.len();
    let failed_count = requested_count.saturating_sub(loaded_count);

    GexExpirationCoverage {
        requested_count,
        returned_count: requested_count,
        loaded_count,
        failed_count,
        complete: source_status == "ok" && failed_count == 0,
        capped: false,
    }
}

fn build_gex_payload(
    summary: &GexSummary,
    contracts: &[GexContract],
    spot_quote: &SpotQuote,
    computed_at: chrono::DateTime<Utc>,
    source_status: &str,
    source_message: Option<&str>,
) -> serde_json::Value {
    let provider = resolve_payload_provider(spot_quote, contracts);
    let expiration_coverage = build_expiration_coverage(contracts, summary.spot, source_status);
    let chain_updated_at = oldest_contract_timestamp(contracts);
    let is_stale = is_gex_data_stale(computed_at, spot_quote.as_of, chain_updated_at);
    let quote_freshness = if is_stale { "delayed" } else { "live" };
    let market_data_mode = if is_stale { "delayed" } else { "live" };
    let with_gamma = contracts
        .iter()
        .filter(|contract| contract.gamma.is_some())
        .count();
    let with_open_interest = contracts
        .iter()
        .filter(|contract| contract.open_interest.is_some())
        .count();
    let with_implied_volatility = contracts
        .iter()
        .filter(|contract| contract.implied_volatility.is_some())
        .count();
    let options: Vec<_> = contracts
        .iter()
        .filter(|contract| contract_gex(contract, summary.spot).is_some())
        .map(|contract| {
            let expiration =
                chrono::NaiveDate::parse_from_str(&contract.expiration_date, "%Y-%m-%d").ok();
            json!({
                "strike": contract.strike,
                "expireYear": expiration.map(|date| date.year()).unwrap_or_default(),
                "expireMonth": expiration.map(|date| date.month()).unwrap_or_default(),
                "expireDay": expiration.map(|date| date.day()).unwrap_or_default(),
                "cp": match contract.right { OptionRight::Call => "C", OptionRight::Put => "P" },
                "ticker": contract.ticker,
                "underlying": contract.underlying,
                "expirationDate": contract.expiration_date,
                "providerContractId": contract.provider_contract_id,
                "gamma": contract.gamma.unwrap_or_default(),
                "delta": contract.delta.unwrap_or_default(),
                "theta": contract.theta,
                "vega": contract.vega,
                "openInterest": contract.open_interest.unwrap_or_default(),
                "impliedVol": contract.implied_volatility.unwrap_or_default(),
                "bid": contract.bid.unwrap_or_default(),
                "ask": contract.ask.unwrap_or_default(),
                "mark": contract.mark,
                "multiplier": contract.multiplier,
                "sharesPerContract": contract.shares_per_contract,
                "volume": contract.volume,
                "updatedAt": contract.updated_at.map(|date| date.to_rfc3339()),
                "quoteFreshness": quote_freshness,
                "marketDataMode": market_data_mode
            })
        })
        .collect();

    json!({
        "ticker": summary.symbol,
        "tickerDetails": {
            "ticker": summary.symbol,
            "name": summary.symbol,
            "sector": "",
            "industry": "",
            "marketCap": null,
            "exchangeShortName": "",
            "country": "",
            "isEtf": false,
            "isFund": false
        },
        "profile": {
            "price": summary.spot,
            "changes": spot_quote.change.unwrap_or_default(),
            "range": format!("{:.2}-{:.2}", summary.spot, summary.spot),
            "dayLow": summary.spot,
            "dayHigh": summary.spot,
            "yearLow": null,
            "yearHigh": null,
            "mktCap": null,
            "logo": null
        },
        "spot": summary.spot,
        "timestamp": computed_at.to_rfc3339(),
        "isStale": is_stale,
        "options": options,
        "snapshots": [{ "ts": computed_at.to_rfc3339(), "netGex": summary.net_gex }],
        "flowContext": null,
        "flowContextStatus": "unavailable",
        "source": {
            "provider": provider,
            "status": source_status,
            "expirationCoverage": {
                "requestedCount": expiration_coverage.requested_count,
                "returnedCount": expiration_coverage.returned_count,
                "loadedCount": expiration_coverage.loaded_count,
                "failedCount": expiration_coverage.failed_count,
                "complete": expiration_coverage.complete,
                "capped": expiration_coverage.capped
            },
            "optionCount": summary.option_count,
            "usableOptionCount": summary.usable_option_count,
            "withGamma": with_gamma,
            "withOpenInterest": with_open_interest,
            "withImpliedVolatility": with_implied_volatility,
            "quoteUpdatedAt": spot_quote.as_of.to_rfc3339(),
            "chainUpdatedAt": chain_updated_at.map(|date| date.to_rfc3339()),
            "flowStatus": "unavailable",
            "flowEventCount": 0,
            "classifiedFlowEventCount": 0,
            "flowClassificationCoverage": 0,
            "flowClassificationBasisCounts": { "quoteMatch": 0, "tickTest": 0, "none": 0 },
            "flowClassificationConfidenceCounts": { "high": 0, "medium": 0, "low": 0, "none": 0 },
            "message": source_message
        }
    })
}

fn oldest_contract_timestamp(contracts: &[GexContract]) -> Option<DateTime<Utc>> {
    contracts
        .iter()
        .filter_map(|contract| contract.updated_at)
        .min()
}

fn resolve_payload_provider(spot_quote: &SpotQuote, contracts: &[GexContract]) -> String {
    let option_source = contracts
        .iter()
        .map(|contract| contract.source.as_str())
        .find(|source| !source.trim().is_empty());
    normalize_payload_provider(option_source.unwrap_or(spot_quote.source.as_str())).unwrap_or_else(
        || normalize_payload_provider(&spot_quote.source).unwrap_or_else(|| "massive".to_string()),
    )
}

fn normalize_payload_provider(source: &str) -> Option<String> {
    let normalized = source.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.contains("massive") {
        return Some("massive".to_string());
    }
    if normalized.contains("ibkr") {
        return Some("ibkr".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_contract() -> GexContract {
        GexContract {
            ticker: Some("O:SPY300118C00500000".into()),
            underlying: "SPY".into(),
            provider_contract_id: Some("contract-1".into()),
            expiration_date: "2030-01-18".into(),
            strike: 500.0,
            right: OptionRight::Call,
            gamma: Some(0.01),
            delta: Some(0.5),
            theta: Some(-0.02),
            vega: Some(0.1),
            open_interest: Some(100.0),
            implied_volatility: Some(0.2),
            bid: Some(1.0),
            ask: Some(1.2),
            mark: Some(1.1),
            multiplier: 100.0,
            shares_per_contract: 100.0,
            volume: Some(25.0),
            source: "massive".into(),
            updated_at: Some(Utc::now()),
        }
    }

    #[test]
    fn contract_gex_rejects_invalid_gamma_and_multiplier() {
        let cases = [
            ("negative gamma", -0.01, 100.0),
            ("zero multiplier", 0.01, 0.0),
            ("negative multiplier", 0.01, -100.0),
            ("NaN multiplier", 0.01, f64::NAN),
            ("infinite multiplier", 0.01, f64::INFINITY),
        ];
        let accepted: Vec<_> = cases
            .into_iter()
            .filter_map(|(name, gamma, multiplier)| {
                let mut contract = valid_contract();
                contract.gamma = Some(gamma);
                contract.multiplier = multiplier;
                contract_gex(&contract, 500.0).is_some().then_some(name)
            })
            .collect();

        assert!(
            accepted.is_empty(),
            "contract_gex accepted invalid cases: {accepted:?}"
        );
    }

    #[test]
    fn stale_quote_or_chain_is_rejected_before_persistence() {
        let computed_at = Utc::now();
        let stale_at = computed_at - chrono::Duration::seconds(GEX_STALE_AFTER_SECS + 1);
        for (name, spot_as_of, chain_updated_at) in [
            ("stale quote", stale_at, Some(computed_at)),
            ("stale chain", computed_at, Some(stale_at)),
        ] {
            assert!(
                ensure_gex_inputs_fresh(computed_at, spot_as_of, chain_updated_at).is_err(),
                "{name} must be rejected before persistence"
            );
        }
    }

    #[test]
    fn future_dated_gex_inputs_are_rejected_at_exact_boundaries() {
        let computed_at = Utc::now();
        let one_nanosecond_future = computed_at + chrono::Duration::nanoseconds(1);
        let far_future = computed_at + chrono::Duration::days(365);
        let accepted: Vec<_> = [
            (
                "sub-second future spot",
                one_nanosecond_future,
                Some(computed_at),
            ),
            ("far-future spot", far_future, Some(computed_at)),
            (
                "sub-second future chain",
                computed_at,
                Some(one_nanosecond_future),
            ),
            ("far-future chain", computed_at, Some(far_future)),
        ]
        .into_iter()
        .filter_map(|(name, spot_as_of, chain_updated_at)| {
            ensure_gex_inputs_fresh(computed_at, spot_as_of, chain_updated_at)
                .is_ok()
                .then_some(name)
        })
        .collect();

        assert!(
            accepted.is_empty(),
            "future-dated GEX inputs were accepted: {accepted:?}"
        );
    }

    #[test]
    fn recent_past_gex_inputs_remain_fresh() {
        let computed_at = Utc::now();
        let recent = computed_at - chrono::Duration::milliseconds(119_999);

        assert!(ensure_gex_inputs_fresh(computed_at, recent, Some(recent)).is_ok());
    }

    #[test]
    fn contract_gex_rejects_numeric_24_6_overflow() {
        let mut contract = valid_contract();
        contract.gamma = Some(1.0);
        contract.open_interest = Some(100_000_000.0);

        assert!(
            contract_gex(&contract, 100_000.0).is_none(),
            "a per-contract GEX value at 1e18 cannot fit numeric(24,6)"
        );
    }

    #[test]
    fn summarized_gex_never_exceeds_numeric_24_6() {
        let mut contract = valid_contract();
        contract.gamma = Some(0.6);
        contract.open_interest = Some(100_000_000.0);

        assert!(
            summarize_gex("SPY", 100_000.0, &[contract.clone(), contract]).is_err(),
            "aggregate GEX at 1.2e18 cannot fit numeric(24,6)"
        );
    }

    #[test]
    fn summarized_gex_preserves_small_exposure_between_large_opposing_values() {
        let mut large_call = valid_contract();
        large_call.gamma = Some(1.0);
        large_call.open_interest = Some(100_000_000_000.0);

        let mut small_call = valid_contract();
        small_call.gamma = Some(0.000001);
        small_call.open_interest = Some(1.0);

        let mut large_put = large_call.clone();
        large_put.right = OptionRight::Put;

        let summary = summarize_gex("SPY", 1_000.0, &[large_call, small_call, large_put]).unwrap();

        assert!((summary.net_gex - 1.0).abs() < 1e-12);
    }

    #[test]
    fn oldest_contract_timestamp_controls_payload_freshness() {
        let computed_at = Utc::now();
        let fresh_at = computed_at - chrono::Duration::seconds(GEX_STALE_AFTER_SECS - 4);
        let stale_at = computed_at - chrono::Duration::seconds(GEX_STALE_AFTER_SECS + 1);
        let spot_quote = SpotQuote {
            spot: 500.0,
            change: None,
            source: "massive".into(),
            as_of: fresh_at,
        };
        let mut fresh_contract = valid_contract();
        fresh_contract.updated_at = Some(fresh_at);
        let mut stale_contract = valid_contract();
        stale_contract.ticker = Some("O:SPY300118P00500000".into());
        stale_contract.right = OptionRight::Put;
        stale_contract.updated_at = Some(stale_at);
        let contracts = [fresh_contract, stale_contract];
        let summary = summarize_gex("SPY", spot_quote.spot, &contracts).unwrap();

        let payload = build_gex_payload(&summary, &contracts, &spot_quote, computed_at, "ok", None);

        assert_eq!(payload["isStale"], true);
        assert_eq!(payload["source"]["chainUpdatedAt"], stale_at.to_rfc3339());
    }

    #[test]
    fn persisted_gex_uses_one_database_clock_and_locked_prerequisite() {
        let source = include_str!("gex.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        assert!(!source.contains("let computed_at = utc::now()"));
        assert!(source.contains("select now()"));
        assert!(source.contains("lock_gex_prerequisite_tx"));
    }

    #[test]
    fn gex_reader_uses_premium_multiplier_independent_of_persisted_contracts() {
        let sql = LOAD_LATEST_OPTION_SNAPSHOTS_SQL
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();
        let selects_premium_multiplier = [
            "100 as multiplier",
            "100.0 as multiplier",
            "100::float8 as multiplier",
            "100.0::float8 as multiplier",
        ]
        .iter()
        .any(|expression| sql.contains(expression));

        assert!(
            selects_premium_multiplier && !sql.contains("contract.multiplier"),
            "Massive GEX must always use multiplier 100, not a persisted legacy value"
        );
    }

    #[test]
    fn gex_reader_never_blends_option_chain_generations() {
        let sql = LOAD_LATEST_OPTION_SNAPSHOTS_SQL
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        assert!(
            sql.contains("snap.as_of = $2") && !sql.contains("interval '5 seconds'"),
            "GEX must select one exact option-chain generation"
        );
    }

    #[test]
    fn gex_rejects_a_partly_overwritten_option_chain_generation() {
        assert!(ensure_option_chain_generation_complete(2, 1).is_err());
        assert!(ensure_option_chain_generation_complete(2, 2).is_ok());
    }

    #[test]
    fn run_once_selects_the_exact_max_option_chain_generation() {
        let sql = LOAD_LATEST_OPTION_GENERATION_SQL
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        assert!(sql.contains("max(snap.as_of)"));
        assert!(sql.contains("snap.as_of = latest_chain.as_of"));
    }

    #[test]
    fn bucketed_gex_uses_the_locked_prerequisite_generation_receipt() {
        let source = include_str!("gex.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .to_ascii_lowercase();

        for required in [
            "let generation = lock_gex_prerequisite_tx",
            "some(generation) => generation",
            "generation.as_of",
            "ensure_option_chain_generation_complete(expected_option_count, raw_option_count)",
        ] {
            assert!(
                source.contains(required),
                "bucketed GEX generation wiring is missing {required}"
            );
        }
    }
}
