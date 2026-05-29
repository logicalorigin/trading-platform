#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FlowPremiumSummary {
    pub bullish_premium: f64,
    pub bearish_premium: f64,
    pub neutral_premium: f64,
}

impl FlowPremiumSummary {
    pub fn total(&self) -> f64 {
        self.bullish_premium + self.bearish_premium + self.neutral_premium
    }
}
