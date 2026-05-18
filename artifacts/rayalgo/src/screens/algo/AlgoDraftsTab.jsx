import { AlgoDraftStrategiesPanel } from "../../features/backtesting/BacktestingPanels";
import { T, fs, sp, dim } from "../../lib/uiTokens.jsx";

export const AlgoDraftsTab = ({ isVisible }) => (
  <AlgoDraftStrategiesPanel
    theme={T}
    scale={{ fs, sp, dim }}
    isVisible={isVisible}
  />
);

export default AlgoDraftsTab;
