import { T } from "../../../lib/uiTokens.jsx";

const DEFAULT_TONES = {
  buy: T.green,
  sell: T.red,
  hot: T.green,
  cold: T.cyan,
  warn: T.amber,
  stale: T.amber,
  info: T.cyan,
  dim: T.textDim,
};

const PALETTES = {
  default: DEFAULT_TONES,
  deuteranopia: DEFAULT_TONES,
  protanopia: DEFAULT_TONES,
  tritanopia: DEFAULT_TONES,
};

export const getTone = (kind, palette = "default") => {
  const selected = PALETTES[palette] || DEFAULT_TONES;
  return selected[kind] || DEFAULT_TONES.dim;
};

export default getTone;
