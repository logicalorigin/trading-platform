import { CSS_COLOR, T } from "../../lib/uiTokens";

export const flowProviderColor = (provider) =>
  provider === "ibkr" ? CSS_COLOR.accent : provider === "massive" ? CSS_COLOR.cyan : CSS_COLOR.textDim;
