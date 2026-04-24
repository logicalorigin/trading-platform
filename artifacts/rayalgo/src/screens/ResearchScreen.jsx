import {
  Suspense,
} from "react";
import {
  PhotonicsObservatory,
} from "../RayAlgoPlatform";
import {
  T,
  dim,
  fs,
  sp,
} from "../lib/uiTokens";

const ResearchLoadingFallback = () => (
  <div
    style={{
      height: "100%",
      minHeight: dim(240),
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: sp(10),
      background: T.bg0,
      color: T.textDim,
      fontFamily: T.sans,
    }}
  >
    <style>
      {"@keyframes researchScreenSpin { to { transform: rotate(360deg); } }"}
    </style>
    <span
      style={{
        width: dim(20),
        height: dim(20),
        borderRadius: "50%",
        border: `2px solid ${T.border}`,
        borderTopColor: T.accent,
        animation: "researchScreenSpin 900ms linear infinite",
      }}
    />
    <span
      style={{
        fontSize: fs(11),
        fontWeight: 700,
        color: T.textSec,
      }}
    >
      Loading research workspace
    </span>
  </div>
);

export const ResearchScreen = ({ onJumpToTrade, isVisible = false }) => (
  <Suspense fallback={<ResearchLoadingFallback />}>
    <PhotonicsObservatory onJumpToTrade={onJumpToTrade} isVisible={isVisible} />
  </Suspense>
);

export default ResearchScreen;
