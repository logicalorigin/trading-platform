import {
  Suspense,
} from "react";
import {
  T,
  dim,
  sp,
} from "../lib/uiTokens";
import { lazyWithRetry } from "../lib/dynamicImport";
import { PanelLoadingState } from "../components/platform/primitives.jsx";
import { WorkspaceLinkChip } from "../features/platform/WorkspaceLinkChip.jsx";

const PhotonicsObservatory = lazyWithRetry(
  () => import("../features/research/PhotonicsObservatory.jsx"),
  { label: "PhotonicsObservatory" },
);

const ResearchLoadingFallback = () => (
  <div
    style={{
      height: "100%",
      minHeight: dim(240),
      display: "flex",
      alignItems: "stretch",
      justifyContent: "center",
      padding: sp(16),
      background: T.bg0,
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <div style={{ width: "min(100%, 620px)", alignSelf: "center" }}>
      <PanelLoadingState
        testId="research-suspense-loading"
        title="Loading research workspace"
        detail="Fetching the authored research shell and theme universe."
        rows={3}
        tone={T.accent}
      />
    </div>
  </div>
);

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  linkedContext = null,
  onLinkedWorkspaceGroupChange,
  onLinkedContextChange,
}) => (
  <div style={{ position: "relative", height: "100%", minHeight: 0 }}>
    <div
      style={{
        position: "absolute",
        top: sp(8),
        right: sp(8),
        zIndex: 20,
      }}
    >
      <WorkspaceLinkChip
        panelId="research"
        context={linkedContext}
        compact
        onChangeGroup={onLinkedWorkspaceGroupChange}
      />
    </div>
    <Suspense fallback={<ResearchLoadingFallback />}>
      <PhotonicsObservatory
        onJumpToTrade={onJumpToTrade}
        isVisible={isVisible}
        onLinkedContextChange={onLinkedContextChange}
      />
    </Suspense>
  </div>
);

export default ResearchScreen;
