import {
  Suspense,
} from "react";
import LogoLoader from "../components/LogoLoader";
import { lazyWithRetry } from "../lib/dynamicImport";

const PhotonicsObservatory = lazyWithRetry(
  () => import("../features/research/PhotonicsObservatory.jsx"),
  { label: "PhotonicsObservatory" },
);

export const ResearchScreen = ({
  onJumpToTrade,
  isVisible = false,
  onReadinessChange,
}) => (
  <Suspense fallback={<LogoLoader tone="panel" minHeight="100%" />}>
    <PhotonicsObservatory
      onJumpToTrade={onJumpToTrade}
      isVisible={isVisible}
      onReadinessChange={onReadinessChange}
    />
  </Suspense>
);

export default ResearchScreen;
