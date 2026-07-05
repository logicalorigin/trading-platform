// Module-level flag so the looping NeuralLoader knows when the first-load
// NeuralBootOverlay already owns a WebGL context, and can degrade to BrandLoader
// instead of spinning up a second one during boot. No `three` import — stays
// eager and cheap.

let openerActive = false;

export function setNeuralOpenerActive(value: boolean): void {
  openerActive = value;
}

export function isNeuralOpenerActive(): boolean {
  return openerActive;
}
