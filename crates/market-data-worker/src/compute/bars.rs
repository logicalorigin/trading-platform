#![allow(dead_code)]

use chrono::{DateTime, Utc};

#[derive(Debug, Clone, PartialEq)]
pub struct Bar {
    pub starts_at: DateTime<Utc>,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    pub volume: f64,
}

pub fn normalize_bars(mut bars: Vec<Bar>) -> Vec<Bar> {
    bars.sort_by_key(|bar| bar.starts_at);
    bars
}
