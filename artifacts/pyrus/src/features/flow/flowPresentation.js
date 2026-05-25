import { T } from "../../lib/uiTokens";

export const flowProviderColor = (provider) =>
  provider === "ibkr" ? T.accent : provider === "polygon" ? T.cyan : T.textDim;
