use anyhow::{anyhow, Result};
use chrono::{Datelike, Utc};
use serde::Serialize;
use serde_json::json;
use sqlx::{PgPool, Row};

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
    pub open_interest: Option<f64>,
    pub implied_volatility: Option<f64>,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub multiplier: f64,
    pub shares_per_contract: f64,
    pub volume: Option<f64>,
    pub updated_at: Option<chrono::DateTime<Utc>>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GexSummary {
    pub symbol: String,
    pub spot: f64,
    pub net_gex: f64,
    pub option_count: usize,
    pub usable_option_count: usize,
}

pub fn contract_gex(contract: &GexContract, spot: f64) -> Option<f64> {
    let gamma = contract.gamma?;
    let open_interest = contract.open_interest?;
    if !(spot > 0.0 && gamma.is_finite() && open_interest.is_finite()) {
        return None;
    }
    let sign = match contract.right {
        OptionRight::Call => 1.0,
        OptionRight::Put => -1.0,
    };
    Some(sign * gamma * open_interest * contract.multiplier * spot * spot * 0.01)
}

pub fn summarize_gex(symbol: &str, spot: f64, contracts: &[GexContract]) -> GexSummary {
    let mut net_gex = 0.0;
    let mut usable_option_count = 0;
    for contract in contracts {
        if let Some(value) = contract_gex(contract, spot) {
            net_gex += value;
            usable_option_count += 1;
        }
    }
    GexSummary {
        symbol: symbol.to_string(),
        spot,
        net_gex,
        option_count: contracts.len(),
        usable_option_count,
    }
}

pub async fn compute_and_persist_gex_snapshot(
    pool: &PgPool,
    symbol_input: &str,
) -> Result<GexSummary> {
    let symbol = symbol_input.trim().to_uppercase();
    if symbol.is_empty() {
        return Err(anyhow!("symbol is required"));
    }

    let spot = load_latest_spot(pool, &symbol).await?;
    let contracts = load_latest_option_snapshots(pool, &symbol).await?;
    if contracts.is_empty() {
        return Err(anyhow!("no option-chain snapshots found for {symbol}"));
    }

    let summary = summarize_gex(&symbol, spot, &contracts);
    if summary.usable_option_count == 0 {
        return Err(anyhow!("no usable option contracts found for {symbol}"));
    }

    let computed_at = Utc::now();
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
    let payload = build_gex_payload(&summary, &contracts, computed_at, source_status, source_message);

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
    .execute(pool)
    .await?;

    Ok(summary)
}

async fn load_latest_spot(pool: &PgPool, symbol: &str) -> Result<f64> {
    let row = sqlx::query(
        r#"
        select last::float8 as spot
        from quote_cache
        where symbol = $1 and last is not null
        order by as_of desc
        limit 1
        "#,
    )
    .bind(symbol)
    .fetch_optional(pool)
    .await?;
    let spot = row
        .and_then(|row| row.try_get::<Option<f64>, _>("spot").ok().flatten())
        .ok_or_else(|| anyhow!("no latest spot quote found for {symbol}"))?;
    if spot <= 0.0 || !spot.is_finite() {
        return Err(anyhow!("latest spot quote is invalid for {symbol}"));
    }
    Ok(spot)
}

async fn load_latest_option_snapshots(pool: &PgPool, symbol: &str) -> Result<Vec<GexContract>> {
    let rows = sqlx::query(
        r#"
        with latest as (
          select distinct on (snap.option_contract_id)
            snap.option_contract_id,
            snap.bid::float8 as bid,
            snap.ask::float8 as ask,
            snap.mark::float8 as mark,
            snap.implied_volatility::float8 as implied_volatility,
            snap.delta::float8 as delta,
            snap.gamma::float8 as gamma,
            snap.open_interest::float8 as open_interest,
            snap.volume::float8 as volume,
            snap.as_of,
            contract.polygon_ticker,
            contract.provider_contract_id,
            contract.expiration_date::text as expiration_date,
            contract.strike::float8 as strike,
            contract.right::text as right,
            contract.multiplier,
            contract.shares_per_contract
          from option_chain_snapshots snap
          join option_contracts contract on contract.id = snap.option_contract_id
          join instruments underlying on underlying.id = snap.underlying_instrument_id
          where underlying.symbol = $1
          order by snap.option_contract_id, snap.as_of desc
        )
        select * from latest order by expiration_date asc, strike asc
        "#,
    )
    .bind(symbol)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let right_raw: String = row.try_get("right")?;
            let right = match right_raw.as_str() {
                "call" => OptionRight::Call,
                "put" => OptionRight::Put,
                _ => return Err(anyhow!("unsupported option right {right_raw}")),
            };
            Ok(GexContract {
                ticker: row.try_get("polygon_ticker")?,
                underlying: symbol.to_string(),
                provider_contract_id: row.try_get("provider_contract_id")?,
                expiration_date: row.try_get("expiration_date")?,
                strike: row.try_get("strike")?,
                right,
                gamma: row.try_get("gamma")?,
                delta: row.try_get("delta")?,
                open_interest: row.try_get("open_interest")?,
                implied_volatility: row.try_get("implied_volatility")?,
                bid: row.try_get("bid")?,
                ask: row.try_get("ask")?,
                multiplier: row.try_get::<i32, _>("multiplier")? as f64,
                shares_per_contract: row.try_get::<i32, _>("shares_per_contract")? as f64,
                volume: row.try_get("volume")?,
                updated_at: row.try_get("as_of")?,
            })
        })
        .collect()
}

fn build_gex_payload(
    summary: &GexSummary,
    contracts: &[GexContract],
    computed_at: chrono::DateTime<Utc>,
    source_status: &str,
    source_message: Option<&str>,
) -> serde_json::Value {
    let options: Vec<_> = contracts
        .iter()
        .filter(|contract| contract_gex(contract, summary.spot).is_some())
        .map(|contract| {
            let expiration = chrono::NaiveDate::parse_from_str(&contract.expiration_date, "%Y-%m-%d").ok();
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
                "openInterest": contract.open_interest.unwrap_or_default(),
                "impliedVol": contract.implied_volatility.unwrap_or_default(),
                "bid": contract.bid.unwrap_or_default(),
                "ask": contract.ask.unwrap_or_default(),
                "multiplier": contract.multiplier,
                "sharesPerContract": contract.shares_per_contract,
                "volume": contract.volume.unwrap_or_default(),
                "updatedAt": contract.updated_at.map(|date| date.to_rfc3339()),
                "quoteFreshness": "live",
                "marketDataMode": "live"
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
            "country": "US",
            "isEtf": false,
            "isFund": false
        },
        "profile": {
            "price": summary.spot,
            "dayLow": summary.spot,
            "dayHigh": summary.spot,
            "yearLow": null,
            "yearHigh": null,
            "mktCap": null,
            "logo": null
        },
        "spot": summary.spot,
        "timestamp": computed_at.to_rfc3339(),
        "isStale": false,
        "options": options,
        "snapshots": [{ "ts": computed_at.to_rfc3339(), "netGex": summary.net_gex }],
        "flowContext": null,
        "flowContextStatus": "unavailable",
        "source": {
            "provider": "massive",
            "status": source_status,
            "optionCount": summary.option_count,
            "usableOptionCount": summary.usable_option_count,
            "withGamma": summary.usable_option_count,
            "withOpenInterest": summary.usable_option_count,
            "withImpliedVolatility": contracts.iter().filter(|contract| contract.implied_volatility.is_some()).count(),
            "quoteUpdatedAt": computed_at.to_rfc3339(),
            "chainUpdatedAt": computed_at.to_rfc3339(),
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

#[cfg(test)]
mod tests {
    use super::*;

    fn contract(right: OptionRight, gamma: Option<f64>, open_interest: Option<f64>) -> GexContract {
        GexContract {
            ticker: None,
            underlying: "SPY".into(),
            provider_contract_id: None,
            expiration_date: "2026-05-15".into(),
            strike: 100.0,
            right,
            gamma,
            delta: Some(0.5),
            open_interest,
            implied_volatility: Some(0.2),
            bid: Some(1.0),
            ask: Some(1.1),
            multiplier: 100.0,
            shares_per_contract: 100.0,
            volume: Some(10.0),
            updated_at: None,
        }
    }

    #[test]
    fn computes_call_and_put_gex_with_signs() {
        let contracts = vec![
            contract(OptionRight::Call, Some(0.02), Some(10.0)),
            contract(OptionRight::Put, Some(0.01), Some(10.0)),
        ];
        let summary = summarize_gex("SPY", 100.0, &contracts);

        assert_eq!(summary.option_count, 2);
        assert_eq!(summary.usable_option_count, 2);
        assert_eq!(summary.net_gex, 1_000.0);
    }

    #[test]
    fn skips_contracts_missing_gamma_or_open_interest() {
        let contracts = vec![
            contract(OptionRight::Call, Some(0.02), Some(10.0)),
            contract(OptionRight::Put, None, Some(10.0)),
            contract(OptionRight::Put, Some(0.01), None),
        ];
        let summary = summarize_gex("SPY", 100.0, &contracts);

        assert_eq!(summary.option_count, 3);
        assert_eq!(summary.usable_option_count, 1);
        assert_eq!(summary.net_gex, 2_000.0);
    }
}
