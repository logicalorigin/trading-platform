import {
  Suspense,
} from "react";
import LogoLoader from "../components/LogoLoader";
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

const ResearchWorkspaceFallback = () => (
  <LogoLoader
    tone="panel"
    label="Loading research workspace"
    minHeight="100%"
    testId="research-workspace-loading"
  />
);

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => (
  <Suspense fallback={<ResearchWorkspaceFallback />}>
    <PhotonicsObservatory
      onJumpToTrade={onJumpToTrade}
      isVisible={isVisible}
      onReadinessChange={onReadinessChange}
    />
  </Suspense>
);

export default ResearchScreen;
