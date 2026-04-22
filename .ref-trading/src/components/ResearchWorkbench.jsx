import React, { useEffect } from "react";
import LiveWiringBanner from "./LiveWiringBanner.jsx";
import ResearchWorkbenchChartPanel from "./research/ResearchWorkbenchChartPanel.jsx";
import ResearchWorkbenchInsightsPanel from "./research/ResearchWorkbenchInsightsPanel.jsx";
import ResearchWorkbenchOptionPanel from "./research/ResearchWorkbenchOptionPanel.jsx";
import ResearchWorkbenchTopControls from "./research/ResearchWorkbenchTopControls.jsx";
import { useResearchWorkbenchViewModel } from "../research/hooks/useResearchWorkbenchViewModel.js";

const FS = "'IBM Plex Sans',-apple-system,sans-serif";
const BG = "#ffffff";
const WORKBENCH_MIN_PAGE_HEIGHT = 1100;

export default function ResearchWorkbench({ isActive = true, navigateToSurface = null, setHeaderUtility = null } = {}) {
  const {
    topControlsProps,
    chartPanelProps,
    optionPanelProps,
    insightsProps,
  } = useResearchWorkbenchViewModel({
    isActive,
    navigateToSurface,
  });

  useEffect(() => {
    if (typeof setHeaderUtility !== "function") {
      return undefined;
    }
    if (!isActive) {
      setHeaderUtility(null);
      return undefined;
    }
    setHeaderUtility(
      <div style={{ width: "min(100%, 540px)", minWidth: 0 }}>
        <LiveWiringBanner symbol={topControlsProps.marketSymbol} marginBottom={0} compact />
      </div>,
    );
    return () => {
      setHeaderUtility(null);
    };
  }, [isActive, setHeaderUtility, topControlsProps.marketSymbol]);

  return (
    <div
      style={{
        minHeight: "max(100vh, " + WORKBENCH_MIN_PAGE_HEIGHT + "px)",
        background: BG,
        fontFamily: FS,
        color: "#1f2937",
      }}
    >
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <div style={{ padding: "5px 10px 0" }}>
        <ResearchWorkbenchTopControls {...topControlsProps} />
      </div>
      <div style={{ display: "grid", gap: 8, padding: "0 10px 10px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1.08fr) minmax(340px, 0.92fr)",
            gap: 8,
            alignItems: "start",
            minHeight: 620,
          }}
        >
          <ResearchWorkbenchChartPanel {...chartPanelProps} isActive={isActive} />
          <ResearchWorkbenchOptionPanel {...optionPanelProps} />
        </div>
        <div style={{ paddingTop: 4 }}>
          <ResearchWorkbenchInsightsPanel {...insightsProps} />
        </div>
      </div>
    </div>
  );
}
