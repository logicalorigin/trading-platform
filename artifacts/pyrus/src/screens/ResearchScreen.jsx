import {
  Suspense,
} from "react";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";

const loadPhotonicsObservatory = () =>
  import("../features/research/PhotonicsObservatory.jsx");

const PhotonicsObservatory = lazyWithRetry(loadPhotonicsObservatory, {
  label: "PhotonicsObservatory",
});

if (typeof window !== "undefined") {
  preloadDynamicImport(loadPhotonicsObservatory, {
    label: "PhotonicsObservatory",
  });
}

const ResearchLoadingShell = () => (
  <div
    data-testid="research-loading-shell"
    aria-busy="true"
    style={{
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      display: "grid",
      gridTemplateRows: "auto minmax(0, 1fr)",
      gap: "12px",
      padding: "16px 24px",
      background: "var(--ra-surface-0)",
      color: "var(--ra-text-primary)",
      fontFamily: "var(--ra-font-sans)",
    }}
  >
    <div style={{ display: "grid", gap: "3px", minWidth: 0 }}>
      <span
        style={{
          color: "var(--ra-text-secondary)",
          fontSize: "10px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Preparing workspace
      </span>
      <span style={{ fontSize: "16px", fontWeight: 600, lineHeight: 1.2 }}>
        Research
      </span>
    </div>
    <div
      style={{
        minWidth: 0,
        minHeight: 0,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: "8px",
      }}
    >
      {["Universe", "Themes", "Thesis"].map((section) => (
        <div
          key={section}
          style={{
            minHeight: "160px",
            border: "1px solid var(--ra-border-default)",
            background: "var(--ra-surface-1)",
            display: "grid",
            alignContent: "start",
            gap: "10px",
            padding: "12px",
            overflow: "hidden",
          }}
        >
          <span
            style={{
              color: "var(--ra-text-secondary)",
              fontSize: "10px",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {section}
          </span>
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              style={{
                display: "block",
                width: `${92 - index * 13}%`,
                height: "8px",
                background: "var(--ra-surface-3)",
                opacity: 0.62,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => (
  <Suspense fallback={<ResearchLoadingShell />}>
    <PhotonicsObservatory
      onJumpToTrade={onJumpToTrade}
      isVisible={isVisible}
      onReadinessChange={onReadinessChange}
    />
  </Suspense>
);

export default ResearchScreen;
