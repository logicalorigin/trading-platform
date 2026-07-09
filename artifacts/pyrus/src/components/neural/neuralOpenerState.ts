// Module-level flag so the looping NeuralLoader knows when the first-load
// NeuralBootOverlay already owns a WebGL context, and can degrade to BrandLoader
// instead of spinning up a second one during boot. No `three` import — stays
// eager and cheap.

let openerActive = false;
const listeners = new Set<() => void>();

export function setNeuralOpenerActive(value: boolean): void {
  if (openerActive === value) return;
  openerActive = value;
  listeners.forEach((listener) => listener());
}

export function isNeuralOpenerActive(): boolean {
  return openerActive;
}

export function subscribeNeuralOpenerActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
