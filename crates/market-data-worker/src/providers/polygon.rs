use anyhow::{anyhow, Result};
use reqwest::{Client, Url};
use serde::Deserialize;

use crate::config::MarketDataProviderConfig;

#[derive(Debug, Clone, PartialEq)]
pub struct OptionChainSnapshot {
    pub ticker: String,
    pub expiration_date: String,
    pub strike: f64,
    pub right: String,
    pub shares_per_contract: i32,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub last: Option<f64>,
    pub mark: Option<f64>,
    pub implied_volatility: Option<f64>,
    pub delta: Option<f64>,
    pub gamma: Option<f64>,
    pub theta: Option<f64>,
    pub vega: Option<f64>,
    pub open_interest: Option<i32>,
    pub volume: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct ChainResponse {
    #[serde(default)]
    results: Vec<ChainResult>,
    next_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ChainResult {
    details: Option<ContractDetails>,
    last_quote: Option<LastQuote>,
    last_trade: Option<LastTrade>,
    greeks: Option<Greeks>,
    day: Option<Day>,
    open_interest: Option<f64>,
    implied_volatility: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ContractDetails {
    ticker: Option<String>,
    expiration_date: Option<String>,
    strike_price: Option<f64>,
    contract_type: Option<String>,
    shares_per_contract: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct LastQuote {
    bid: Option<f64>,
    ask: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct LastTrade {
    price: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Greeks {
    delta: Option<f64>,
    gamma: Option<f64>,
    theta: Option<f64>,
    vega: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Day {
    volume: Option<f64>,
}

pub async fn fetch_option_chain_snapshots(
    client: &Client,
    config: &MarketDataProviderConfig,
    underlying: &str,
    max_pages: usize,
) -> Result<Vec<OptionChainSnapshot>> {
    let mut url = Url::parse(&format!(
        "{}/v3/snapshot/options/{}",
        config.base_url,
        underlying.trim().to_uppercase()
    ))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("order", "asc");
        query.append_pair("sort", "strike_price");
        query.append_pair("limit", "250");
        query.append_pair("apiKey", &config.api_key);
    }

    let mut snapshots = Vec::new();
    let mut next_url = Some(url);
    let mut page_count = 0usize;
    while let Some(url) = next_url {
        if page_count >= max_pages.max(1) {
            break;
        }
        let payload = client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .json::<ChainResponse>()
            .await?;
        snapshots.extend(payload.results.into_iter().filter_map(map_chain_result));
        next_url = payload
            .next_url
            .and_then(|value| build_next_url(&value, &config.api_key).ok());
        page_count += 1;
    }

    if snapshots.is_empty() {
        return Err(anyhow!("provider returned no option-chain snapshots"));
    }
    Ok(snapshots)
}

fn build_next_url(value: &str, api_key: &str) -> Result<Url> {
    let mut url = Url::parse(value)?;
    if !url.query_pairs().any(|(key, _)| key == "apiKey") {
        url.query_pairs_mut().append_pair("apiKey", api_key);
    }
    Ok(url)
}

fn map_chain_result(result: ChainResult) -> Option<OptionChainSnapshot> {
    let details = result.details?;
    let ticker = details.ticker?;
    let expiration_date = details.expiration_date?;
    let strike = details.strike_price?;
    let right = match details.contract_type?.as_str() {
        "call" => "call".to_string(),
        "put" => "put".to_string(),
        _ => return None,
    };
    let shares_per_contract = details
        .shares_per_contract
        .filter(|value| value.is_finite() && *value > 0.0)
        .unwrap_or(100.0)
        .round() as i32;
    let bid = result.last_quote.as_ref().and_then(|quote| quote.bid);
    let ask = result.last_quote.as_ref().and_then(|quote| quote.ask);
    let last = result.last_trade.and_then(|trade| trade.price);
    let mark = match (bid, ask, last) {
        (Some(bid), Some(ask), _) if bid > 0.0 && ask > 0.0 => Some((bid + ask) / 2.0),
        (_, _, last) => last,
    };
    Some(OptionChainSnapshot {
        ticker,
        expiration_date,
        strike,
        right,
        shares_per_contract,
        bid,
        ask,
        last,
        mark,
        implied_volatility: result.implied_volatility,
        delta: result.greeks.as_ref().and_then(|greeks| greeks.delta),
        gamma: result.greeks.as_ref().and_then(|greeks| greeks.gamma),
        theta: result.greeks.as_ref().and_then(|greeks| greeks.theta),
        vega: result.greeks.as_ref().and_then(|greeks| greeks.vega),
        open_interest: result.open_interest.map(|value| value.round() as i32),
        volume: result
            .day
            .and_then(|day| day.volume)
            .map(|value| value.round() as i32),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_option_chain_snapshot_with_mid_mark() {
        let snapshot = map_chain_result(ChainResult {
            details: Some(ContractDetails {
                ticker: Some("O:SPY260515C00100000".into()),
                expiration_date: Some("2026-05-15".into()),
                strike_price: Some(100.0),
                contract_type: Some("call".into()),
                shares_per_contract: Some(100.0),
            }),
            last_quote: Some(LastQuote {
                bid: Some(1.0),
                ask: Some(1.2),
            }),
            last_trade: Some(LastTrade { price: Some(1.1) }),
            greeks: Some(Greeks {
                delta: Some(0.5),
                gamma: Some(0.02),
                theta: None,
                vega: None,
            }),
            day: Some(Day { volume: Some(10.0) }),
            open_interest: Some(25.0),
            implied_volatility: Some(0.2),
        })
        .expect("snapshot");

        assert_eq!(snapshot.right, "call");
        assert_eq!(snapshot.mark, Some(1.1));
        assert_eq!(snapshot.open_interest, Some(25));
    }
}
