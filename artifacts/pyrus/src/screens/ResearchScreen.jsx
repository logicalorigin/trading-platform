import { useEffect } from "react";
import PhotonicsObservatory from "../features/research/PhotonicsObservatory.jsx";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import { useViewport } from "../lib/responsive";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  T,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => {
  const { flags: { isPhone } } = useViewport();
  const contentReady = Boolean(isVisible);
  const primaryReady = Boolean(isVisible);

  useEffect(() => {
    onReadinessChange?.({
      contentReady,
      primaryReady,
      derivedReady: false,
      backgroundAllowed: false,
      error: null,
    });
  }, [contentReady, onReadinessChange, primaryReady]);

  useEffect(() => {
    if (!isVisible) return;
    markRouteDataTiming("research", "interactive-ready", {
      source: "route-shell",
    });
  }, [isVisible]);

  return (
    <section
      data-testid="research-screen"
      style={{
        height: "100%",
        minHeight: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: sp(12),
        padding: isPhone ? sp(8) : sp(14),
        background: CSS_COLOR.bg0,
        color: CSS_COLOR.text,
        fontFamily: T.sans,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: sp(10),
          alignItems: "baseline",
          minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: CSS_COLOR.textDim,
              fontSize: textSize("caption"),
              fontWeight: FONT_WEIGHTS.regular,
            }}
          >
            Research
          </div>
          <div
            style={{
              color: CSS_COLOR.text,
              fontSize: isPhone ? fs(15) : fs(18),
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1.1,
            }}
          >
            Market research workspace
          </div>
        </div>
      </header>
      <PhotonicsObservatory
        onJumpToTrade={onJumpToTrade}
        isVisible={isVisible}
        onReadinessChange={onReadinessChange}
      />
    </section>
  );
};

export default ResearchScreen;
