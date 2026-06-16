// DEV-ONLY harness: drives the real GateLadder component with impact data
// produced by the real buildAlgoTuningImpact model fed mock candidates, so the
// histogram + threshold + blocked counts come from production code, not a mock.
// Throwaway: delete with preview-gates.html.
import { createRoot } from "react-dom/client";
import "./index.css";
import { CSS_COLOR, dim, sp, T, textSize } from "./lib/uiTokens.jsx";
import { buildAlgoTuningImpact } from "./features/platform/algoTuningImpactModel.js";
import { GateLadder } from "./screens/algo/GateLadder.jsx";

const pct = (v) => `${Number(v).toFixed(0)}%`;
const money2 = (v) => `$${Number(v).toFixed(2)}`;

// Mock candidate book. Each candidate carries liquidity values + a blocker
// reason, exactly the shape buildAlgoTuningImpact reads.
const c = (symbol, spread, bid, reason) => ({
  symbol,
  reason,
  dte: 1,
  liquidity: { spreadPctOfMid: spread, bid },
  orderPlan: { premiumAtRisk: 500 },
});
const candidates = [
  c("SPY", 4, 0.8, ""),
  c("QQQ", 5, 0.6, ""),
  c("NVDA", 6, 0.4, ""),
  c("AAPL", 7, 0.3, ""),
  c("GOOG", 5, 0.5, ""),
  c("DIA", 6, 0.9, ""),
  c("MSFT", 9, 0.2, "spread_too_wide"),
  c("IWM", 10, 0.25, "spread_too_wide"),
  c("TSLA", 12, 0.15, "spread_too_wide"),
  c("AMZN", 14, 0.07, "spread_too_wide"),
  c("META", 3, 0.05, "bid_below_minimum"),
  c("AMD", 8, 0.09, "bid_below_minimum"),
];

const profile = {
  liquidityGate: { maxSpreadPctOfMid: 8, minBid: 0.1 },
  optionSelection: { minDte: 0, maxDte: 5 },
  riskCaps: { maxPremiumPerEntry: 1500 },
};

const impact = buildAlgoTuningImpact({ cockpit: { candidates }, profile, positions: [] });

const PANEL = {
  width: 360,
  display: "flex",
  flexDirection: "column",
  gap: dim(8),
  border: `1px solid ${CSS_COLOR.border}`,
  borderRadius: 8,
  background: CSS_COLOR.bg1,
  padding: sp("12px"),
  boxSizing: "border-box",
};

function App() {
  return (
    <div style={{ background: CSS_COLOR.bg0, minHeight: "100vh", padding: 20, display: "flex", gap: 24, alignItems: "flex-start" }}>
      <div style={PANEL}>
        <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: CSS_COLOR.textMuted }}>
          GateLadder · real buildAlgoTuningImpact · {candidates.length} candidates · 360px
        </div>
        <GateLadder label="Max spread" threshold={8} direction="max" fmt={pct} impact={impact.spreadTooWide} />
        <GateLadder label="Min bid" threshold={0.1} direction="min" fmt={money2} impact={impact.bidBelowMinimum} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("gate-root")).render(<App />);
