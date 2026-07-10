/**
 * Single source of truth for the Pyrus mark's geometry + gradient.
 *
 * The 2D SVG mark and neural logo target share this geometry. Coordinates are
 * in the SVG's 200x200 viewBox space, centered at (100, 100).
 */

export const MARK_VIEWBOX = 200;
export const MARK_CENTER = 100;
export interface RingSpec {
  id: string;
  /** Radius in viewBox units. */
  r: number;
  strokeWidth: number;
  opacity: number;
  /** SVG strokeDasharray [dash, gap], or null for a solid ring. */
  dash: [number, number] | null;
}

/** Concentric rings, outermost first. Mirrors the `<circle>` stack in PyrusMark. */
export const RING_SPECS: RingSpec[] = [
  { id: "ring-06-outer-data-grid", r: 82, strokeWidth: 4, opacity: 0.95, dash: [10, 6] },
  { id: "ring-05-execution-track", r: 71, strokeWidth: 1.5, opacity: 0.9, dash: [1.5, 3] },
  { id: "boundary-r62", r: 62, strokeWidth: 1.1, opacity: 0.9, dash: [0.8, 3] },
  { id: "ring-03-model-transition", r: 50, strokeWidth: 2.5, opacity: 0.95, dash: [6, 4] },
  { id: "ring-01-inner-ticks-outer", r: 40, strokeWidth: 1, opacity: 0.85, dash: [3, 3] },
  { id: "boundary-r30", r: 30, strokeWidth: 0.9, opacity: 0.85, dash: [0.6, 2.4] },
];

/** Particle rim (72 dots at r=94), the outermost rotating element. */
export const RIM_DOTS = { count: 72, r: 94, dotR: 1 };

/** Rim-dot positions in viewBox space (used by the SVG mark). */
export function rimDotPositions() {
  return Array.from({ length: RIM_DOTS.count }, (_, i) => {
    const angle = (i / RIM_DOTS.count) * Math.PI * 2;
    return {
      cx: MARK_CENTER + Math.cos(angle) * RIM_DOTS.r,
      cy: MARK_CENTER + Math.sin(angle) * RIM_DOTS.r,
    };
  });
}
