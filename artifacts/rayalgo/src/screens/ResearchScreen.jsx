import {
  Suspense,
} from "react";
import {
  PhotonicsObservatory,
} from "../RayAlgoPlatform";

export const ResearchScreen = ({ onJumpToTrade }) => (
  <Suspense fallback={null}>
    <PhotonicsObservatory onJumpToTrade={onJumpToTrade} />
  </Suspense>
);

export default ResearchScreen;
