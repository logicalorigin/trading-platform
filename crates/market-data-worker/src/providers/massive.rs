#![allow(dead_code)]

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MassiveEndpointFamily {
    StockSnapshot,
    StockAggregates,
    OptionChainSnapshot,
    OptionTrades,
    Reference,
}
