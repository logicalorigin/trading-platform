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

export const getTone = (kind) => DEFAULT_TONES[kind] || DEFAULT_TONES.dim;

export default getTone;
