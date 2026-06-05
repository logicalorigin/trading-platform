use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use reqwest::header::HeaderMap;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::config::MarketDataProviderConfig;

#[derive(Debug, Clone, PartialEq)]
pub struct ProviderRequestMetadata {
    pub http_status: Option<i32>,
    pub rate_limit_reset_at: Option<DateTime<Utc>>,
}

impl ProviderRequestMetadata {
    fn empty() -> Self {
        Self {
            http_status: None,
            rate_limit_reset_at: None,
        }
    }

    fn from_response(status: reqwest::StatusCode, headers: &HeaderMap) -> Self {
        Self {
            http_status: Some(status.as_u16() as i32),
            rate_limit_reset_at: parse_rate_limit_reset_header(headers),
        }
    }

    fn merge(&mut self, other: ProviderRequestMetadata) {
        self.http_status = other.http_status.or(self.http_status);
        self.rate_limit_reset_at = match (self.rate_limit_reset_at, other.rate_limit_reset_at) {
            (Some(left), Some(right)) => Some(left.max(right)),
            (Some(left), None) => Some(left),
            (None, Some(right)) => Some(right),
            (None, None) => None,
        };
    }
}

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

#[derive(Debug, Clone, PartialEq)]
pub struct OptionChainFetchResult {
    pub snapshots: Vec<OptionChainSnapshot>,
    pub page_count: usize,
    pub truncated: bool,
    pub metadata: ProviderRequestMetadata,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockSnapshot {
    pub symbol: String,
    pub bid: Option<f64>,
    pub ask: Option<f64>,
    pub last: f64,
    pub bid_size: Option<i32>,
    pub ask_size: Option<i32>,
    pub last_size: Option<i32>,
    pub change: Option<f64>,
    pub change_percent: Option<f64>,
    pub as_of: DateTime<Utc>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct StockSnapshotFetchResult {
    pub snapshot: StockSnapshot,
    pub metadata: ProviderRequestMetadata,
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
) -> Result<OptionChainFetchResult> {
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
    let mut metadata = ProviderRequestMetadata::empty();
    let page_limit = max_pages.max(1);
    while let Some(url) = next_url.take() {
        if page_count >= page_limit {
            next_url = Some(url);
            break;
        }
        let response = client.get(url).send().await?;
        let page_metadata =
            ProviderRequestMetadata::from_response(response.status(), response.headers());
        let payload = response.error_for_status()?.json::<ChainResponse>().await?;
        metadata.merge(page_metadata);
        snapshots.extend(payload.results.into_iter().filter_map(map_chain_result));
        next_url = payload
            .next_url
            .and_then(|value| build_next_url(&value, &config.api_key).ok());
        page_count += 1;
    }

    if snapshots.is_empty() {
        return Err(anyhow!("provider returned no option-chain snapshots"));
    }
    Ok(OptionChainFetchResult {
        snapshots,
        page_count,
        truncated: next_url.is_some(),
        metadata,
    })
}

pub async fn fetch_stock_snapshot(
    client: &Client,
    config: &MarketDataProviderConfig,
    symbol: &str,
) -> Result<StockSnapshotFetchResult> {
    let symbol = normalize_symbol(symbol);
    if symbol.is_empty() {
        return Err(anyhow!("symbol is required"));
    }

    let mut url = Url::parse(&format!(
        "{}/v2/snapshot/locale/us/markets/stocks/tickers",
        config.base_url
    ))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("tickers", &symbol);
        query.append_pair("apiKey", &config.api_key);
    }

    let response = client.get(url).send().await?;
    let metadata = ProviderRequestMetadata::from_response(response.status(), response.headers());
    let payload = response.error_for_status()?.json::<Value>().await?;

    let snapshot = derive_snapshot_array(&payload)
        .into_iter()
        .filter_map(map_stock_snapshot)
        .find(|snapshot| snapshot.symbol == symbol)
        .ok_or_else(|| anyhow!("provider returned no usable stock snapshot for {symbol}"))?;
    Ok(StockSnapshotFetchResult { snapshot, metadata })
}

fn parse_rate_limit_reset_header(headers: &HeaderMap) -> Option<DateTime<Utc>> {
    [
        "x-ratelimit-reset",
        "x-rate-limit-reset",
        "ratelimit-reset",
        "retry-after",
    ]
    .iter()
    .find_map(|name| {
        headers
            .get(*name)
            .and_then(|value| value.to_str().ok())
            .and_then(parse_rate_limit_reset_value)
    })
}

fn parse_rate_limit_reset_value(value: &str) -> Option<DateTime<Utc>> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(number) = trimmed.parse::<f64>() {
        if !number.is_finite() || number < 0.0 {
            return None;
        }
        if number >= 1e11 {
            return DateTime::<Utc>::from_timestamp_millis(number.round() as i64);
        }
        if number >= 1e9 {
            return DateTime::<Utc>::from_timestamp(number.round() as i64, 0);
        }
        return Some(Utc::now() + chrono::Duration::seconds(number.round() as i64));
    }
    DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn build_next_url(value: &str, api_key: &str) -> Result<Url> {
    let mut url = Url::parse(value)?;
    if !url.query_pairs().any(|(key, _)| key == "apiKey") {
        url.query_pairs_mut().append_pair("apiKey", api_key);
    }
    Ok(url)
}

fn normalize_symbol(symbol: &str) -> String {
    let normalized = symbol.trim().to_uppercase();
    if normalized.len() >= 3 {
        let bytes = normalized.as_bytes();
        if bytes.iter().any(|byte| *byte == b' ' || *byte == b'-') {
            return normalized.replace([' ', '-'], ".");
        }
    }
    normalized
}

fn derive_snapshot_array(payload: &Value) -> Vec<&Value> {
    if let Some(array) = payload.as_array() {
        return array.iter().collect();
    }
    if let Some(record) = payload.as_object() {
        for key in ["tickers", "results"] {
            if let Some(array) = record.get(key).and_then(Value::as_array) {
                return array.iter().collect();
            }
        }
        for key in ["ticker", "snapshot"] {
            if let Some(value) = record.get(key).filter(|value| value.is_object()) {
                return vec![value];
            }
        }
    }
    Vec::new()
}

fn object_field<'a>(record: &'a Map<String, Value>, keys: &[&str]) -> Option<&'a Value> {
    keys.iter().find_map(|key| record.get(*key))
}

fn value_number(value: Option<&Value>) -> Option<f64> {
    let value = value?;
    let number = match value {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => {
            let stripped = text
                .trim()
                .trim_start_matches(|character: char| {
                    !character.is_ascii_digit()
                        && character != '.'
                        && character != '+'
                        && character != '-'
                })
                .replace(',', "");
            if stripped.is_empty() {
                None
            } else {
                stripped.parse::<f64>().ok()
            }
        }
        _ => None,
    }?;
    number.is_finite().then_some(number)
}

fn value_i32(value: Option<&Value>) -> Option<i32> {
    value_number(value)
        .filter(|value| value.is_finite())
        .map(|value| value.round() as i32)
}

fn nested_object<'a>(
    record: &'a Map<String, Value>,
    keys: &[&str],
) -> Option<&'a Map<String, Value>> {
    object_field(record, keys).and_then(Value::as_object)
}

fn nested_number(record: Option<&Map<String, Value>>, keys: &[&str]) -> Option<f64> {
    value_number(record.and_then(|record| object_field(record, keys)))
}

fn nested_i32(record: Option<&Map<String, Value>>, keys: &[&str]) -> Option<i32> {
    value_i32(record.and_then(|record| object_field(record, keys)))
}

fn value_datetime(value: Option<&Value>) -> Option<DateTime<Utc>> {
    let value = value?;
    if let Some(number) = value_number(Some(value)) {
        let abs = number.abs();
        let millis = if abs >= 1e17 {
            number / 1e6
        } else if abs >= 1e14 {
            number / 1e3
        } else if abs >= 1e11 {
            number
        } else if abs >= 1e9 {
            number * 1e3
        } else {
            number
        };
        return DateTime::<Utc>::from_timestamp_millis(millis.round() as i64);
    }
    match value {
        Value::String(text) => DateTime::parse_from_rfc3339(text.trim())
            .ok()
            .map(|date| date.with_timezone(&Utc)),
        _ => None,
    }
}

fn nested_datetime(record: Option<&Map<String, Value>>, keys: &[&str]) -> Option<DateTime<Utc>> {
    value_datetime(record.and_then(|record| object_field(record, keys)))
}

fn map_stock_snapshot(snapshot: &Value) -> Option<StockSnapshot> {
    let record = snapshot.as_object()?;
    let symbol = object_field(record, &["ticker", "symbol"])
        .and_then(Value::as_str)
        .map(normalize_symbol)?;
    if symbol.is_empty() {
        return None;
    }

    let last_trade = nested_object(record, &["lastTrade", "last_trade"]);
    let last_quote = nested_object(record, &["lastQuote", "last_quote"]);
    let minute_bar = nested_object(record, &["min", "minute", "minuteBar"]);
    let day_bar = nested_object(record, &["day"]);
    let prev_day_bar = nested_object(record, &["prevDay", "prev_day"]);

    let last = nested_number(last_trade, &["p", "price"])
        .or_else(|| nested_number(minute_bar, &["c", "close"]))
        .or_else(|| nested_number(day_bar, &["c", "close"]))
        .or_else(|| value_number(object_field(record, &["currentPrice", "price", "last"])))?;
    if !(last > 0.0 && last.is_finite()) {
        return None;
    }

    let bid = nested_number(last_quote, &["p", "bp", "bid", "bidPrice", "bid_price"]);
    let ask = nested_number(last_quote, &["P", "ap", "ask", "askPrice", "ask_price"]);
    let bid_size = nested_i32(last_quote, &["s", "bs", "bidSize", "bid_size"]);
    let ask_size = nested_i32(last_quote, &["S", "as", "askSize", "ask_size"]);
    let last_size = nested_i32(last_trade, &["s", "size", "lastSize", "last_size"]);
    let prev_close = nested_number(prev_day_bar, &["c", "close"]);
    let change = value_number(object_field(record, &["todaysChange", "change"]))
        .or_else(|| prev_close.map(|prev_close| last - prev_close));
    let change_percent = value_number(object_field(
        record,
        &["todaysChangePerc", "changePercent", "change_percent"],
    ))
    .or_else(|| {
        prev_close
            .filter(|prev_close| *prev_close != 0.0)
            .map(|prev_close| ((last - prev_close) / prev_close) * 100.0)
    });
    let as_of = nested_datetime(last_quote, &["t", "timestamp"])
        .or_else(|| nested_datetime(last_trade, &["t", "timestamp"]))
        .or_else(|| nested_datetime(minute_bar, &["t", "timestamp"]))
        .or_else(|| nested_datetime(day_bar, &["t", "timestamp"]))
        .unwrap_or_else(Utc::now);

    Some(StockSnapshot {
        symbol,
        bid,
        ask,
        last,
        bid_size,
        ask_size,
        last_size,
        change,
        change_percent,
        as_of,
    })
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
