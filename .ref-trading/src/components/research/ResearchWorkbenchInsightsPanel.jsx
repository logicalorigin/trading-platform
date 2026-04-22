import React from "react";

const ResearchWorkbenchInsights = React.lazy(
  () => import("./ResearchWorkbenchInsights.jsx"),
);

const F = "'IBM Plex Mono','Fira Code',monospace";
const CARD = "#ffffff";
const BORDER = "#e8eaed";
const SH1 = "0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)";

export default function ResearchWorkbenchInsightsPanel(props) {
  return (
    <React.Suspense
      fallback={
        <div
          style={{
            height: "100%",
            minHeight: 260,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: CARD,
            border: "1px solid " + BORDER,
            borderRadius: 8,
            boxShadow: SH1,
            color: "#9ca3af",
            fontFamily: F,
            fontSize: 14,
          }}
        >
          Loading analysis...
        </div>
      }
    >
      <ResearchWorkbenchInsights {...props} />
    </React.Suspense>
  );
}
