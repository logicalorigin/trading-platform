use std::collections::HashSet;
use std::fmt;

use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::header::HeaderMap;
use reqwest::{Client, Url};
use serde::Deserialize;
use serde_json::Number;

use crate::config::MarketDataProviderConfig;

const NUMERIC_18_6_ABS_LIMIT: f64 = 1_000_000_000_000.0;
const OPTION_CHAIN_PAGE_ROW_LIMIT: usize = 250;
const OPTION_CHAIN_PAGE_BYTE_LIMIT: usize = 4 * 1024 * 1024;

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

#[derive(Debug)]
struct ProviderRequestError {
    metadata: ProviderRequestMetadata,
    source: reqwest::Error,
}

impl fmt::Display for ProviderRequestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "provider request failed with HTTP status {}",
            self.metadata
                .http_status
                .map_or_else(|| "unknown".to_string(), |status| status.to_string())
        )?;
        if let Some(reset_at) = self.metadata.rate_limit_reset_at {
            write!(formatter, "; retry at {}", reset_at.to_rfc3339())?;
        }
        Ok(())
    }
}

impl std::error::Error for ProviderRequestError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(&self.source)
    }
}

pub fn provider_request_metadata(error: &anyhow::Error) -> ProviderRequestMetadata {
    if let Some(error) = error.downcast_ref::<ProviderRequestError>() {
        return error.metadata.clone();
    }
    ProviderRequestMetadata {
        http_status: error
            .downcast_ref::<reqwest::Error>()
            .and_then(reqwest::Error::status)
            .map(|status| status.as_u16() as i32),
        rate_limit_reset_at: None,
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

#[derive(Debug, Deserialize)]
struct ChainResponse {
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
    open_interest: Option<Number>,
    implied_volatility: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ContractDetails {
    ticker: Option<String>,
    underlying_ticker: Option<String>,
    expiration_date: Option<String>,
    strike_price: Option<f64>,
    contract_type: Option<String>,
    shares_per_contract: Option<Number>,
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
    volume: Option<Number>,
}

pub async fn fetch_option_chain_snapshots(
    client: &Client,
    config: &MarketDataProviderConfig,
    underlying: &str,
    max_pages: usize,
) -> Result<OptionChainFetchResult> {
    let underlying = underlying.trim().to_uppercase();
    let mut url = Url::parse(&format!(
        "{}/v3/snapshot/options/{}",
        config.base_url, underlying
    ))?;
    {
        let mut query = url.query_pairs_mut();
        query.append_pair("order", "asc");
        query.append_pair("sort", "strike_price");
        query.append_pair("limit", "250");
        query.append_pair("apiKey", &config.api_key);
    }

    let mut snapshots = Vec::new();
    let provider_origin = url.clone();
    let mut next_url = Some(url);
    let mut page_count = 0usize;
    let mut metadata = ProviderRequestMetadata::empty();
    let mut seen_tickers = HashSet::new();
    let page_limit = max_pages.max(1);
    while let Some(url) = next_url.take() {
        if page_count >= page_limit {
            next_url = Some(url);
            break;
        }
        let response = client
            .get(url)
            .send()
            .await
            .map_err(reqwest::Error::without_url)?;
        let page_metadata =
            ProviderRequestMetadata::from_response(response.status(), response.headers());
        let mut response = response
            .error_for_status()
            .map_err(|source| ProviderRequestError {
                metadata: page_metadata.clone(),
                source: source.without_url(),
            })?;
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(reqwest::Error::without_url)?
        {
            if body.len().saturating_add(chunk.len()) > OPTION_CHAIN_PAGE_BYTE_LIMIT {
                return Err(anyhow!("provider option-chain page exceeded byte limit"));
            }
            body.extend_from_slice(&chunk);
        }
        let payload: ChainResponse = serde_json::from_slice(&body)
            .map_err(|_| anyhow!("provider returned invalid option-chain JSON"))?;
        metadata.merge(page_metadata);
        let result_count = payload.results.len();
        if result_count == 0 || result_count > OPTION_CHAIN_PAGE_ROW_LIMIT {
            return Err(anyhow!(
                "provider returned invalid option-chain page row count"
            ));
        }
        let has_next_page = payload
            .next_url
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
        if result_count == OPTION_CHAIN_PAGE_ROW_LIMIT && !has_next_page {
            return Err(anyhow!(
                "provider option-chain completion is ambiguous at the page limit"
            ));
        }
        for result in payload.results {
            let snapshot = map_chain_result(result, &underlying)?;
            if !seen_tickers.insert(snapshot.ticker.clone()) {
                return Err(anyhow!("provider returned duplicate option identity"));
            }
            snapshots.push(snapshot);
        }
        next_url = match payload.next_url {
            Some(value) if !value.trim().is_empty() => {
                Some(build_next_url(&value, &config.api_key, &provider_origin)?)
            }
            _ => None,
        };
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
        .or_else(|_| DateTime::parse_from_rfc2822(trimmed))
        .ok()
        .map(|date| date.with_timezone(&Utc))
}

fn build_next_url(value: &str, api_key: &str, initial_url: &Url) -> Result<Url> {
    let mut url = initial_url
        .join(value.trim())
        .map_err(|_| anyhow!("provider returned an invalid pagination URL"))?;
    if url.scheme() != initial_url.scheme()
        || url.host_str() != initial_url.host_str()
        || url.port_or_known_default() != initial_url.port_or_known_default()
    {
        return Err(anyhow!("provider pagination URL changed origin"));
    }
    if !url.query_pairs().any(|(key, _)| key == "apiKey") {
        url.query_pairs_mut().append_pair("apiKey", api_key);
    }
    Ok(url)
}

fn valid_optional_number(
    value: Option<f64>,
    field: &str,
    valid: impl Fn(f64) -> bool,
) -> Result<Option<f64>> {
    match value {
        Some(value)
            if value.is_finite() && value.abs() < NUMERIC_18_6_ABS_LIMIT && valid(value) =>
        {
            Ok(Some(value))
        }
        Some(_) => Err(anyhow!("provider schema mismatch: invalid {field}")),
        None => Ok(None),
    }
}

fn exact_i32(value: Number, field: &str, allow_zero: bool) -> Result<i32> {
    let raw = value.to_string();
    let (whole, fractional) = raw.split_once('.').unwrap_or((raw.as_str(), ""));
    if raw.contains(['e', 'E'])
        || fractional.chars().any(|digit| digit != '0')
        || whole.parse::<i64>().ok().is_none_or(|value| {
            value > i32::MAX as i64 || if allow_zero { value < 0 } else { value < 1 }
        })
    {
        return Err(anyhow!("provider schema mismatch: invalid {field}"));
    }
    Ok(whole.parse::<i32>()?)
}

fn parse_occ_identity(
    ticker: &str,
    expected_underlying: &str,
    provider_underlying: Option<&str>,
) -> Result<(String, NaiveDate, i64, &'static str)> {
    let ticker = ticker.trim().to_ascii_uppercase();
    let body = ticker
        .strip_prefix("O:")
        .ok_or_else(|| anyhow!("provider schema mismatch: invalid OCC ticker"))?;
    if !body.is_ascii() || body.len() <= 15 {
        return Err(anyhow!("provider schema mismatch: invalid OCC ticker"));
    }
    let (root, suffix) = body.split_at(body.len() - 15);
    if root.is_empty()
        || !root
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit() || b".-".contains(&byte))
    {
        return Err(anyhow!("provider schema mismatch: invalid OCC root"));
    }
    let adjusted_base = root.trim_end_matches(|character: char| character.is_ascii_digit());
    if root != expected_underlying
        && (adjusted_base == root
            || adjusted_base != expected_underlying
            || provider_underlying != Some(expected_underlying))
    {
        return Err(anyhow!(
            "provider schema mismatch: OCC underlying does not match request"
        ));
    }

    let year = 2000
        + suffix[0..2]
            .parse::<i32>()
            .map_err(|_| anyhow!("provider schema mismatch: invalid OCC expiration"))?;
    let month = suffix[2..4]
        .parse::<u32>()
        .map_err(|_| anyhow!("provider schema mismatch: invalid OCC expiration"))?;
    let day = suffix[4..6]
        .parse::<u32>()
        .map_err(|_| anyhow!("provider schema mismatch: invalid OCC expiration"))?;
    let expiration = NaiveDate::from_ymd_opt(year, month, day)
        .ok_or_else(|| anyhow!("provider schema mismatch: invalid OCC expiration"))?;
    let right = match &suffix[6..7] {
        "C" => "call",
        "P" => "put",
        _ => return Err(anyhow!("provider schema mismatch: invalid OCC right")),
    };
    let strike_millis = suffix[7..]
        .parse::<i64>()
        .map_err(|_| anyhow!("provider schema mismatch: invalid OCC strike"))?;
    Ok((ticker, expiration, strike_millis, right))
}

fn map_chain_result(result: ChainResult, expected_underlying: &str) -> Result<OptionChainSnapshot> {
    let details = result
        .details
        .ok_or_else(|| anyhow!("provider schema mismatch: missing details"))?;
    let ticker_raw = details
        .ticker
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("provider schema mismatch: missing ticker"))?;
    let provider_underlying = details
        .underlying_ticker
        .as_deref()
        .map(|value| value.trim().to_uppercase());
    let (ticker, ticker_expiration, ticker_strike_millis, ticker_right) = parse_occ_identity(
        &ticker_raw,
        expected_underlying,
        provider_underlying.as_deref(),
    )?;
    if provider_underlying
        .as_deref()
        .is_some_and(|value| value != expected_underlying)
    {
        return Err(anyhow!(
            "provider schema mismatch: underlying ticker does not match request"
        ));
    }
    let expiration_date = details
        .expiration_date
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("provider schema mismatch: missing expiration date"))?;
    let parsed_expiration = NaiveDate::parse_from_str(&expiration_date, "%Y-%m-%d")
        .map_err(|_| anyhow!("provider schema mismatch: invalid expiration date"))?;
    if parsed_expiration != ticker_expiration {
        return Err(anyhow!(
            "provider schema mismatch: OCC expiration does not match details"
        ));
    }
    let strike = details
        .strike_price
        .filter(|value| value.is_finite() && *value > 0.0 && value.abs() < NUMERIC_18_6_ABS_LIMIT)
        .ok_or_else(|| anyhow!("provider schema mismatch: invalid strike price"))?;
    let strike_millis = strike * 1000.0;
    if strike_millis.fract() != 0.0 || strike_millis as i64 != ticker_strike_millis {
        return Err(anyhow!(
            "provider schema mismatch: OCC strike does not match details"
        ));
    }
    let right = match details.contract_type.as_deref() {
        Some("call") => "call".to_string(),
        Some("put") => "put".to_string(),
        _ => return Err(anyhow!("provider schema mismatch: invalid contract type")),
    };
    if right != ticker_right {
        return Err(anyhow!(
            "provider schema mismatch: OCC right does not match details"
        ));
    }
    let shares_per_contract = exact_i32(
        details
            .shares_per_contract
            .ok_or_else(|| anyhow!("provider schema mismatch: missing shares per contract"))?,
        "shares per contract",
        false,
    )?;
    let bid = valid_optional_number(
        result.last_quote.as_ref().and_then(|quote| quote.bid),
        "bid",
        |value| value >= 0.0,
    )?;
    let ask = valid_optional_number(
        result.last_quote.as_ref().and_then(|quote| quote.ask),
        "ask",
        |value| value >= 0.0,
    )?;
    let last = valid_optional_number(
        result.last_trade.and_then(|trade| trade.price),
        "last price",
        |value| value >= 0.0,
    )?;
    let mark = match (bid, ask, last) {
        (Some(bid), Some(ask), _) if bid > 0.0 && ask > 0.0 => Some(bid / 2.0 + ask / 2.0),
        (_, _, last) => last,
    };
    let implied_volatility =
        valid_optional_number(result.implied_volatility, "implied volatility", |value| {
            value >= 0.0
        })?;
    let delta = valid_optional_number(
        result.greeks.as_ref().and_then(|greeks| greeks.delta),
        "delta",
        |value| (-1.0..=1.0).contains(&value),
    )?;
    let gamma = valid_optional_number(
        result.greeks.as_ref().and_then(|greeks| greeks.gamma),
        "gamma",
        |value| value >= 0.0,
    )?;
    let theta = valid_optional_number(
        result.greeks.as_ref().and_then(|greeks| greeks.theta),
        "theta",
        |_| true,
    )?;
    let vega = valid_optional_number(
        result.greeks.as_ref().and_then(|greeks| greeks.vega),
        "vega",
        |value| value >= 0.0,
    )?;
    let open_interest = result
        .open_interest
        .map(|value| exact_i32(value, "open interest", true))
        .transpose()?;
    let volume = result
        .day
        .and_then(|day| day.volume)
        .map(|value| exact_i32(value, "volume", true))
        .transpose()?;
    Ok(OptionChainSnapshot {
        ticker,
        expiration_date,
        strike,
        right,
        shares_per_contract,
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
    })
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::{SocketAddr, TcpListener};
    use std::thread::{self, JoinHandle};

    use super::*;
    use chrono::TimeZone;

    fn serve_once(
        status: &str,
        headers: &[(&str, &str)],
        body: &str,
    ) -> (SocketAddr, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let headers = headers
            .iter()
            .map(|(name, value)| format!("{name}: {value}\r\n"))
            .collect::<String>();
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{headers}Connection: close\r\n\r\n{body}",
            body.len()
        );
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            stream.write_all(response.as_bytes()).unwrap();
        });
        (address, server)
    }

    fn serve_pages(bodies: &[&str]) -> (SocketAddr, JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let bodies = bodies
            .iter()
            .map(|body| body.to_string())
            .collect::<Vec<_>>();
        let server = thread::spawn(move || {
            for body in bodies {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = [0_u8; 2048];
                let _ = stream.read(&mut request);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                stream.write_all(response.as_bytes()).unwrap();
            }
        });
        (address, server)
    }

    fn number(raw: &str) -> Number {
        serde_json::from_str(raw).unwrap()
    }

    fn valid_chain_result() -> ChainResult {
        ChainResult {
            details: Some(ContractDetails {
                ticker: Some("O:SPY300118C00500000".into()),
                underlying_ticker: Some("SPY".into()),
                expiration_date: Some("2030-01-18".into()),
                strike_price: Some(500.0),
                contract_type: Some("call".into()),
                shares_per_contract: Some(number("100.0")),
            }),
            last_quote: Some(LastQuote {
                bid: Some(1.0),
                ask: Some(1.2),
            }),
            last_trade: Some(LastTrade { price: Some(1.1) }),
            greeks: Some(Greeks {
                delta: Some(0.5),
                gamma: Some(0.01),
                theta: Some(-0.02),
                vega: Some(0.1),
            }),
            day: Some(Day {
                volume: Some(number("25.0")),
            }),
            open_interest: Some(number("100.0")),
            implied_volatility: Some(0.2),
        }
    }

    #[tokio::test]
    async fn provider_errors_do_not_expose_the_api_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            stream
                .write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .unwrap();
        });
        let api_key = "dont-log-me";
        let config = MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: format!("http://{address}"),
            api_key: api_key.into(),
        };

        let error = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1)
            .await
            .unwrap_err();
        server.join().unwrap();

        assert!(!error.to_string().contains(api_key));
        assert!(!format!("{error:#}").contains(api_key));
        let provider_error = error.downcast_ref::<ProviderRequestError>().unwrap();
        assert_eq!(
            provider_error.source.status(),
            Some(reqwest::StatusCode::INTERNAL_SERVER_ERROR)
        );
        assert!(provider_error.source.url().is_none());
    }

    #[tokio::test]
    async fn mixed_page_with_malformed_identity_fails_the_whole_fetch() {
        let body = r#"{
            "results": [
                {
                    "details": {
                        "ticker": "O:SPY300118C00500000",
                        "expiration_date": "2030-01-18",
                        "strike_price": 500.0,
                        "contract_type": "call",
                        "shares_per_contract": 100.0
                    },
                    "last_quote": { "bid": 1.0, "ask": 1.2 },
                    "greeks": { "gamma": 0.01 },
                    "open_interest": 100.0
                },
                {
                    "details": {
                        "expiration_date": "2030-01-18",
                        "strike_price": 505.0,
                        "contract_type": "call",
                        "shares_per_contract": 100.0
                    }
                }
            ]
        }"#;
        let (address, server) = serve_once("200 OK", &[], body);
        let config = MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: format!("http://{address}"),
            api_key: "test-key".into(),
        };

        let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1).await;
        server.join().unwrap();

        assert!(
            result.is_err(),
            "a malformed required identity must not be filtered from an otherwise valid page"
        );
    }

    #[tokio::test]
    async fn option_identity_must_match_the_request_and_occ_ticker() {
        let mismatches = [
            (
                "cross-underlying ticker",
                "O:QQQ300118C00500000",
                "2030-01-18",
                500.0,
                "call",
            ),
            (
                "expiration mismatch",
                "O:SPY300118C00500000",
                "2030-01-19",
                500.0,
                "call",
            ),
            (
                "strike mismatch",
                "O:SPY300118C00500000",
                "2030-01-18",
                501.0,
                "call",
            ),
            (
                "right mismatch",
                "O:SPY300118C00500000",
                "2030-01-18",
                500.0,
                "put",
            ),
        ];

        for (name, ticker, expiration, strike, right) in mismatches {
            let body = format!(
                r#"{{
                    "results": [{{
                        "details": {{
                            "ticker": "{ticker}",
                            "expiration_date": "{expiration}",
                            "strike_price": {strike},
                            "contract_type": "{right}",
                            "shares_per_contract": 100
                        }}
                    }}]
                }}"#
            );
            let (address, server) = serve_once("200 OK", &[], &body);
            let config = MarketDataProviderConfig {
                provider: "massive".into(),
                base_url: format!("http://{address}"),
                api_key: "test-key".into(),
            };

            let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1).await;
            server.join().unwrap();

            assert!(result.is_err(), "{name} must invalidate the whole fetch");
        }
    }

    #[tokio::test]
    async fn adjusted_occ_root_can_match_its_base_underlying() {
        let body = r#"{
            "results": [{
                "details": {
                    "ticker": "O:BMNG1300118P00011000",
                    "underlying_ticker": " bmng ",
                    "expiration_date": "2030-01-18",
                    "strike_price": 11,
                    "contract_type": "put",
                    "shares_per_contract": 5
                }
            }]
        }"#;
        let (address, server) = serve_once("200 OK", &[], body);
        let config = MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: format!("http://{address}"),
            api_key: "test-key".into(),
        };

        let result = fetch_option_chain_snapshots(&Client::new(), &config, "BMNG", 1).await;
        server.join().unwrap();

        assert_eq!(result.unwrap().snapshots[0].shares_per_contract, 5);
    }

    #[test]
    fn adjusted_occ_root_requires_matching_provider_underlying_metadata() {
        let mut missing = valid_chain_result();
        let missing_details = missing.details.as_mut().unwrap();
        missing_details.ticker = Some("O:SPY1300118C00500000".into());
        missing_details.underlying_ticker = None;
        assert!(
            map_chain_result(missing, "SPY").is_err(),
            "an adjusted OCC root without authoritative metadata must not match its base"
        );

        let mut mismatched = valid_chain_result();
        let mismatched_details = mismatched.details.as_mut().unwrap();
        mismatched_details.ticker = Some("O:SPY1300118C00500000".into());
        mismatched_details.underlying_ticker = Some("QQQ".into());
        assert!(
            map_chain_result(mismatched, "SPY").is_err(),
            "mismatched provider underlying metadata must not authorize an adjusted root"
        );
    }

    #[test]
    fn digit_suffixed_occ_root_without_metadata_matches_only_exact_request() {
        let mut base_request = valid_chain_result();
        let base_details = base_request.details.as_mut().unwrap();
        base_details.ticker = Some("O:SPY1300118C00500000".into());
        base_details.underlying_ticker = None;

        let mut exact_request = valid_chain_result();
        let exact_details = exact_request.details.as_mut().unwrap();
        exact_details.ticker = Some("O:SPY1300118C00500000".into());
        exact_details.underlying_ticker = None;

        assert!(map_chain_result(base_request, "SPY").is_err());
        assert!(map_chain_result(exact_request, "SPY1").is_ok());
    }

    #[tokio::test]
    async fn missing_results_on_a_later_page_fails_the_whole_fetch() {
        let first_page = r#"{
            "results": [{
                "details": {
                    "ticker": "O:SPY300118C00500000",
                    "expiration_date": "2030-01-18",
                    "strike_price": 500.0,
                    "contract_type": "call",
                    "shares_per_contract": 100.0
                },
                "last_quote": { "bid": 1.0, "ask": 1.2 },
                "greeks": { "gamma": 0.01 },
                "open_interest": 100.0
            }],
            "next_url": "/page-2"
        }"#;
        let (address, server) = serve_pages(&[first_page, "{}"]);
        let config = MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: format!("http://{address}"),
            api_key: "test-key".into(),
        };

        let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 2).await;
        server.join().unwrap();

        assert!(
            result.is_err(),
            "a later page without results must invalidate the complete chain"
        );
    }

    #[tokio::test]
    async fn empty_or_duplicate_later_page_fails_the_whole_fetch() {
        let first_page = r#"{
            "results": [{
                "details": {
                    "ticker": "O:SPY300118C00500000",
                    "expiration_date": "2030-01-18",
                    "strike_price": 500,
                    "contract_type": "call",
                    "shares_per_contract": 100
                }
            }],
            "next_url": "/page-2"
        }"#;
        let duplicate_page = r#"{
            "results": [{
                "details": {
                    "ticker": "O:SPY300118C00500000",
                    "expiration_date": "2030-01-18",
                    "strike_price": 500,
                    "contract_type": "call",
                    "shares_per_contract": 100
                }
            }]
        }"#;

        for (name, second_page) in [
            ("empty later page", r#"{"results":[]}"#),
            ("duplicate later page", duplicate_page),
        ] {
            let (address, server) = serve_pages(&[first_page, second_page]);
            let config = MarketDataProviderConfig {
                provider: "massive".into(),
                base_url: format!("http://{address}"),
                api_key: "test-key".into(),
            };

            let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 2).await;
            server.join().unwrap();

            assert!(result.is_err(), "{name} must invalidate the whole fetch");
        }
    }

    #[tokio::test]
    async fn provider_page_size_and_body_bytes_are_bounded() {
        let row = r#"{
            "details": {
                "ticker": "O:SPY300118C00500000",
                "expiration_date": "2030-01-18",
                "strike_price": 500,
                "contract_type": "call",
                "shares_per_contract": 100
            }
        }"#;
        let oversized_page = format!(r#"{{"results":[{}]}}"#, vec![row; 251].join(","));
        let ambiguous_terminal_page = format!(r#"{{"results":[{}]}}"#, vec![row; 250].join(","));
        let oversized_body = format!(
            r#"{{"results":[{row}],"padding":"{}"}}"#,
            "x".repeat(4 * 1024 * 1024)
        );

        for (name, body) in [
            ("row limit", oversized_page.as_str()),
            ("ambiguous terminal page", ambiguous_terminal_page.as_str()),
            ("body byte limit", oversized_body.as_str()),
        ] {
            let (address, server) = serve_once("200 OK", &[], body);
            let config = MarketDataProviderConfig {
                provider: "massive".into(),
                base_url: format!("http://{address}"),
                api_key: "test-key".into(),
            };

            let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1).await;
            server.join().unwrap();

            assert!(result.is_err(), "{name} must invalidate the whole fetch");
        }
    }

    #[tokio::test]
    async fn integer_semantic_fields_reject_fractional_json_lost_by_f64() {
        let body = r#"{
            "results": [{
                "details": {
                    "ticker": "O:SPY300118C00500000",
                    "expiration_date": "2030-01-18",
                    "strike_price": 500,
                    "contract_type": "call",
                    "shares_per_contract": 2147483647.0000001
                }
            }]
        }"#;
        let (address, server) = serve_once("200 OK", &[], body);
        let config = MarketDataProviderConfig {
            provider: "massive".into(),
            base_url: format!("http://{address}"),
            api_key: "test-key".into(),
        };

        let result = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1).await;
        server.join().unwrap();

        assert!(
            result.is_err(),
            "a lexical fraction must not round into an accepted i32"
        );
    }

    #[test]
    fn provider_mapping_rejects_impossible_or_unsafe_values() {
        assert!(map_chain_result(valid_chain_result(), "SPY").is_ok());
        let cases: &[(&str, fn(&mut ChainResult))] = &[
            ("zero strike", |row| {
                row.details.as_mut().unwrap().strike_price = Some(0.0)
            }),
            ("negative strike", |row| {
                row.details.as_mut().unwrap().strike_price = Some(-1.0)
            }),
            ("non-finite strike", |row| {
                row.details.as_mut().unwrap().strike_price = Some(f64::NAN)
            }),
            ("zero deliverable/multiplier", |row| {
                row.details.as_mut().unwrap().shares_per_contract = Some(number("0"))
            }),
            ("negative deliverable/multiplier", |row| {
                row.details.as_mut().unwrap().shares_per_contract = Some(number("-1"))
            }),
            ("fractional deliverable/multiplier", |row| {
                row.details.as_mut().unwrap().shares_per_contract = Some(number("100.5"))
            }),
            ("missing deliverable/multiplier", |row| {
                row.details.as_mut().unwrap().shares_per_contract = None
            }),
            ("negative gamma", |row| {
                row.greeks.as_mut().unwrap().gamma = Some(-0.01)
            }),
            ("non-finite gamma", |row| {
                row.greeks.as_mut().unwrap().gamma = Some(f64::NAN)
            }),
            ("negative open interest", |row| {
                row.open_interest = Some(number("-1"))
            }),
            ("fractionally negative open interest", |row| {
                row.open_interest = Some(number("-0.4"))
            }),
            ("positive fractional open interest", |row| {
                row.open_interest = Some(number("100.5"))
            }),
            ("negative volume", |row| {
                row.day.as_mut().unwrap().volume = Some(number("-1"))
            }),
            ("positive fractional volume", |row| {
                row.day.as_mut().unwrap().volume = Some(number("25.5"))
            }),
            ("negative bid", |row| {
                row.last_quote.as_mut().unwrap().bid = Some(-1.0)
            }),
            ("non-finite bid", |row| {
                row.last_quote.as_mut().unwrap().bid = Some(f64::NAN)
            }),
            ("negative ask", |row| {
                row.last_quote.as_mut().unwrap().ask = Some(-1.0)
            }),
            ("non-finite ask", |row| {
                row.last_quote.as_mut().unwrap().ask = Some(f64::NAN)
            }),
            ("negative last price", |row| {
                row.last_trade.as_mut().unwrap().price = Some(-1.0)
            }),
            ("non-finite last price", |row| {
                row.last_trade.as_mut().unwrap().price = Some(f64::NAN)
            }),
            ("deliverable/multiplier above i32", |row| {
                row.details.as_mut().unwrap().shares_per_contract = Some(number("2147483648"))
            }),
            ("open interest above i32", |row| {
                row.open_interest = Some(number("2147483648"))
            }),
            ("volume above i32", |row| {
                row.day.as_mut().unwrap().volume = Some(number("2147483648"))
            }),
        ];
        let accepted: Vec<_> = cases
            .iter()
            .filter_map(|(name, corrupt)| {
                let mut row = valid_chain_result();
                corrupt(&mut row);
                map_chain_result(row, "SPY").is_ok().then_some(*name)
            })
            .collect();

        assert!(
            accepted.is_empty(),
            "provider mapper accepted invalid cases: {accepted:?}"
        );
    }

    #[test]
    fn provider_mapping_rejects_numeric_18_6_overflow() {
        let mut row = valid_chain_result();
        row.details.as_mut().unwrap().strike_price = Some(1e12);

        assert!(
            map_chain_result(row, "SPY").is_err(),
            "chain decimals must fit PostgreSQL numeric(18,6)"
        );
    }

    #[test]
    fn retry_after_accepts_delta_seconds_and_http_date() {
        let lower_bound = Utc::now() + chrono::Duration::seconds(59);
        let delta_reset = parse_rate_limit_reset_value("60").unwrap();
        let upper_bound = Utc::now() + chrono::Duration::seconds(61);
        assert!((lower_bound..=upper_bound).contains(&delta_reset));

        assert_eq!(
            parse_rate_limit_reset_value("Mon, 21 Oct 2030 07:28:00 GMT"),
            Utc.with_ymd_and_hms(2030, 10, 21, 7, 28, 0).single()
        );
    }

    #[tokio::test]
    async fn http_failures_retain_redacted_status_and_parsed_reset_metadata() {
        let mut violations = Vec::new();
        for (status, code) in [
            ("429 Too Many Requests", "429"),
            ("503 Service Unavailable", "503"),
        ] {
            let (address, server) = serve_once(
                status,
                &[("Retry-After", "Mon, 21 Oct 2030 07:28:00 GMT")],
                "",
            );
            let api_key = format!("secret-{code}");
            let base_url = format!("http://{address}");
            let config = MarketDataProviderConfig {
                provider: "massive".into(),
                base_url: base_url.clone(),
                api_key: api_key.clone(),
            };

            let error = fetch_option_chain_snapshots(&Client::new(), &config, "SPY", 1)
                .await
                .unwrap_err();
            server.join().unwrap();
            let details = format!("{error:#}");
            if !details.contains(code) {
                violations.push(format!("missing status {code}: {details}"));
            }
            if !details.contains("2030-10-21T07:28:00+00:00") {
                violations.push(format!("missing parsed reset for {code}: {details}"));
            }
            if details.contains(&base_url) || details.contains(&api_key) {
                violations.push(format!("unredacted URL or key for {code}: {details}"));
            }
        }

        assert!(violations.is_empty(), "{}", violations.join("\n"));
    }

    #[test]
    fn pagination_stays_on_the_configured_origin() {
        let initial = Url::parse("https://api.massive.com/v3/snapshot/options/SPY").unwrap();
        let next = build_next_url(
            "https://api.massive.com/v3/snapshot/options/SPY?cursor=next",
            "secret",
            &initial,
        )
        .unwrap();
        assert_eq!(
            next.query_pairs()
                .filter(|(key, value)| key == "apiKey" && value == "secret")
                .count(),
            1,
        );
        assert!(build_next_url("https://evil.invalid/page", "secret", &initial).is_err());
        assert!(build_next_url("http://api.massive.com/page", "secret", &initial).is_err());
    }
}
