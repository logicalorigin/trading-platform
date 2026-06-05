import {
  Suspense,
  useEffect,
} from "react";
import LogoLoader from "../components/LogoLoader";
import { ContainerLoadingStatus } from "../components/platform/ContainerLoadingStatus.jsx";
import { lazyWithRetry, preloadDynamicImport } from "../lib/dynamicImport";
import { markRouteDataTiming } from "../features/platform/performanceMetrics";
import {
  CSS_COLOR,
  FONT_WEIGHTS,
  RADII,
  T,
  dim,
  fs,
  sp,
  textSize,
} from "../lib/uiTokens.jsx";

const loadPhotonicsObservatory = () =>
  import("../features/research/PhotonicsObservatory.jsx");

const PhotonicsObservatory = lazyWithRetry(loadPhotonicsObservatory, {
  label: "PhotonicsObservatory",
});

export const preloadScreenModules = () =>
  preloadDynamicImport(loadPhotonicsObservatory, {
    label: "PhotonicsObservatory",
  });

const ResearchWorkspaceFallback = () => (
  <div
    data-testid="research-workspace-loading"
    aria-busy="true"
    aria-label="Loading research workspace"
    style={{
      display: "grid",
      gap: sp(10),
      minHeight: dim(320),
      alignContent: "start",
      border: `1px solid ${CSS_COLOR.border}`,
      borderRadius: dim(RADII.md),
      background: CSS_COLOR.bg1,
      padding: sp(14),
    }}
  >
    <LogoLoader
      tone="panel"
      label="Loading research workspace"
      minHeight={dim(90)}
      testId="research-workspace-loader"
    />
    <ContainerLoadingStatus
      items={[
        {
          id: "research-workspace",
          label: "Research workspace",
          status: "loading",
          detail: "Photonics workspace module and research datasets",
          endpoint: "src/features/research/PhotonicsObservatory.jsx",
        },
      ]}
      testId="research-workspace-loading-waits"
    />
    <span
      className="ra-skeleton-shimmer"
      style={{
        width: "64%",
        height: dim(10),
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg3,
      }}
    />
    <span
      className="ra-skeleton-shimmer"
      style={{
        width: "86%",
        height: dim(10),
        borderRadius: dim(RADII.xs),
        background: CSS_COLOR.bg3,
      }}
    />
  </div>
);

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => {
  useEffect(() => {
    onReadinessChange?.({
      primaryReady: Boolean(isVisible),
      derivedReady: false,
      backgroundAllowed: false,
    });
  }, [isVisible, onReadinessChange]);

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
        padding: sp(14),
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
              fontSize: fs(18),
              fontWeight: FONT_WEIGHTS.regular,
              lineHeight: 1.1,
            }}
          >
            Market research workspace
          </div>
        </div>
      </header>
      <Suspense fallback={<ResearchWorkspaceFallback />}>
        <PhotonicsObservatory
          onJumpToTrade={onJumpToTrade}
          isVisible={isVisible}
          onReadinessChange={onReadinessChange}
        />
      </Suspense>
    </section>
  );
};

export default ResearchScreen;
