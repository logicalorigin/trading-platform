import { AlgoDraftStrategiesPanel } from "../../features/backtesting/BacktestingPanels";
import {
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../../lib/uiTokens.jsx";

export const AlgoDraftsTab = ({ isVisible }) => (
  <div
    data-testid="algo-drafts-tab"
    style={{
      display: "flex",
      flexDirection: "column",
      gap: sp(6),
      background: T.bg1,
      border: `1px solid ${T.border}`,
      borderRadius: dim(RADII.md),
      padding: sp("8px 10px"),
      minWidth: 0,
    }}
  >
    <div style={{ display: "flex", flexDirection: "column", gap: sp(1) }}>
      <span
        style={{
          color: T.text,
          fontFamily: T.sans,
          fontSize: fs(12),
          fontWeight: FONT_WEIGHTS.medium,
        }}
      >
        Drafts
      </span>
      <span
        style={{
          color: T.textDim,
          fontFamily: T.sans,
          fontSize: textSize("caption"),
        }}
      >
        Promote a completed backtest run from this list to use it as the
        source for a new shadow deployment from the Operations tab.
      </span>
    </div>
    <AlgoDraftStrategiesPanel
      theme={T}
      scale={{ fs, sp, dim }}
      isVisible={isVisible}
    />
  </div>
);

export default AlgoDraftsTab;
