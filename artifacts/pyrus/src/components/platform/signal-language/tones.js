const DEFAULT_TONES = {
  buy: "var(--ra-green-500)",
  directionBuy: "var(--ra-blue-500)",
  sell: "var(--ra-red-500)",
  hot: "var(--ra-green-500)",
  cold: "var(--ra-cyan-500)",
  warn: "var(--ra-amber-500)",
  stale: "var(--ra-amber-500)",
  info: "var(--ra-cyan-500)",
  dim: "var(--ra-text-dim)",
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
