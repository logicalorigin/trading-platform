import {
  Drawer,
} from "../../components/platform/Drawer.jsx";
import { CSS_COLOR, T, sp } from "../../lib/uiTokens.jsx";
import { PlatformAlgoMonitorSidebar } from "./PlatformAlgoMonitorSidebar.jsx";

export const MobileActivitySheet = ({
  open,
  onClose,
  environment = "paper",
  dataEnabled = open,
  signalMatrixStates = [],
  signalMonitorEvents = [],
  signalMonitorEventsLoaded = false,
  onOpenAlgo,
  onOpenTradeSymbol,
}) => (
  <Drawer
    open={open}
    onClose={onClose}
    side="right"
    title="Algo Monitor"
    testId="mobile-activity-sheet"
    width={380}
    fullBleed
  >
    <div
      style={{
        minHeight: "100%",
        boxSizing: "border-box",
        padding: sp("8px 8px max(12px, env(safe-area-inset-bottom))"),
        background: CSS_COLOR.bg0,
      }}
    >
      <PlatformAlgoMonitorSidebar
        isVisible={open}
        dataEnabled={Boolean(open && dataEnabled)}
        environment={environment}
        signalMatrixStates={signalMatrixStates}
        signalMonitorEvents={signalMonitorEvents}
        signalMonitorEventsLoaded={signalMonitorEventsLoaded}
        onOpenAlgo={onOpenAlgo}
        onOpenTradeSymbol={onOpenTradeSymbol}
        compactLayout
      />
    </div>
  </Drawer>
);

export default MobileActivitySheet;
