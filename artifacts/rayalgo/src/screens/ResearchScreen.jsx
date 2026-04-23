import {
  Suspense,
} from "react";
import {
  PhotonicsObservatory,
} from "../RayAlgoPlatform";

export const ResearchScreen = ({ onJumpToTrade, isVisible = false }) => (
  <Suspense fallback={null}>
    <PhotonicsObservatory onJumpToTrade={onJumpToTrade} isVisible={isVisible} />
  </Suspense>
);

export default ResearchScreen;
