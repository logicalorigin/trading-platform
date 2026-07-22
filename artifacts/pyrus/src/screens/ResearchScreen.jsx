import { useEffect } from "react";
import PhotonicsObservatory from "../features/research/PhotonicsObservatory.jsx";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => {
  useEffect(() => {
    if (!isVisible) return;
    markRouteDataTiming("research", "interactive-ready", {
      source: "route-shell",
    });
  }, [isVisible]);

  return (
    <PhotonicsObservatory
      onJumpToTrade={onJumpToTrade}
      isVisible={isVisible}
      onReadinessChange={onReadinessChange}
    />
  );
};

export default ResearchScreen;
