import { BottomSheet } from "../../components/platform/BottomSheet.jsx";
import { PortfolioPulseZone } from "./PortfolioPulseZone.jsx";

export const MobilePortfolioPulseSheet = ({
  open,
  onClose,
  accountId,
  mode,
  maskValues,
  brokerAuthenticated,
  watchlistsBusy,
  algoEvents,
  onAlertClick,
  onPositionsClick,
  onOrdersClick,
  onSignalsClick,
  onFlowClick,
  onAlgoClick,
  enabled,
}) => {
  const handleAlert = () => {
    onAlertClick?.();
    onClose?.();
  };
  const handlePositions = () => {
    onPositionsClick?.();
    onClose?.();
  };
  const handleOrders = () => {
    onOrdersClick?.();
    onClose?.();
  };
  const handleSignals = () => {
    onSignalsClick?.();
    onClose?.();
  };
  const handleFlow = () => {
    onFlowClick?.();
    onClose?.();
  };
  const handleAlgo = () => {
    onAlgoClick?.();
    onClose?.();
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Portfolio Pulse"
      testId="mobile-portfolio-pulse-sheet"
      maxHeight="78dvh"
    >
      <PortfolioPulseZone
        vertical
        accountId={accountId}
        mode={mode}
        maskValues={maskValues}
        brokerAuthenticated={brokerAuthenticated}
        watchlistsBusy={watchlistsBusy}
        algoEvents={algoEvents}
        enabled={enabled}
        onAlertClick={handleAlert}
        onPositionsClick={handlePositions}
        onOrdersClick={handleOrders}
        onSignalsClick={handleSignals}
        onFlowClick={handleFlow}
        onAlgoClick={handleAlgo}
      />
    </BottomSheet>
  );
};
