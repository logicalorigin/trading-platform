/**
 * Single source of truth for the Pyrus mark's geometry + gradient.
 *
 * Both the 2D SVG mark (`PyrusMark` in chrome.tsx) and the 3D mark
 * (`pyrus-mark-3d-scene.tsx`) read these constants, so the two code paths stay
 * in parity by construction - the same discipline the hero's two chart paths
 * follow. Coordinates are in the SVG's 200x200 viewBox space, centered at
 * (100, 100); the 3D scene divides by `MARK_CENTER` to map into [-1, 1] world
 * units.
 *
 * No `three` import here - this file must stay safe to import from the eagerly
 * loaded shell.
 */

export const MARK_VIEWBOX = 200;
export const MARK_CENTER = 100;
/** Gradient half-span in viewBox units: the linear gradient runs x=6..194. */
export const MARK_HALF_WIDTH = 94;

export interface RingSpec {
  id: string;
  /** Radius in viewBox units. */
  r: number;
  strokeWidth: number;
  opacity: number;
  /** SVG strokeDasharray [dash, gap], or null for a solid ring. */
  dash: [number, number] | null;
  /** Spin period in seconds, or null for a static ring. */
  durationS: number | null;
  direction: "normal" | "reverse";
}

/** Concentric rings, outermost first. Mirrors the `<circle>` stack in PyrusMark. */
export const RING_SPECS: RingSpec[] = [
  { id: "ring-06-outer-data-grid", r: 82, strokeWidth: 4, opacity: 0.95, dash: [10, 6], durationS: 26, direction: "reverse" },
  { id: "ring-05-execution-track", r: 71, strokeWidth: 1.5, opacity: 0.9, dash: [1.5, 3], durationS: 34, direction: "normal" },
  { id: "boundary-r62", r: 62, strokeWidth: 1.1, opacity: 0.9, dash: [0.8, 3], durationS: null, direction: "normal" },
  { id: "ring-03-model-transition", r: 50, strokeWidth: 2.5, opacity: 0.95, dash: [6, 4], durationS: 44, direction: "reverse" },
  { id: "ring-01-inner-ticks-outer", r: 40, strokeWidth: 1, opacity: 0.85, dash: [3, 3], durationS: 56, direction: "normal" },
  { id: "boundary-r30", r: 30, strokeWidth: 0.9, opacity: 0.85, dash: [0.6, 2.4], durationS: null, direction: "normal" },
];

/** Particle rim (72 dots at r=94), the outermost rotating element. */
export const RIM_DOTS = { count: 72, r: 94, dotR: 1, durationS: 18, direction: "normal" as const };

/** Data-node ticks (18 small rects at the top, r~94), counter-rotating. */
export const DATA_NODES = { count: 18, r: 94, w: 4, h: 5, durationS: 22, direction: "reverse" as const };

/** Gauge arc: 25 ticks spanning -60..+60deg, each a line from r=68 to r=55. */
export const GAUGE = { count: 25, fromDeg: -60, toDeg: 60, innerR: 55, outerR: 68, strokeWidth: 2 };

export interface GradientStop {
  /** 0..1 offset along the horizontal gradient. */
  offset: number;
  rgb: [number, number, number];
  alpha: number;
}

/**
 * The blue -> dark-violet -> red gradient. Hex values match the `<linearGradient>`
 * in pyrus-mark-shared.tsx exactly; rgb is normalized 0..1 for shader/three use.
 */
export const GRADIENT_STOPS: GradientStop[] = [
  { offset: 0.0, rgb: [0.239, 0.722, 1.0], alpha: 1.0 }, // #3DB8FF
  { offset: 0.32, rgb: [0.169, 0.659, 1.0], alpha: 1.0 }, // #2BA8FF
  { offset: 0.44, rgb: [0.227, 0.165, 0.549], alpha: 0.45 }, // #3A2A8C
  { offset: 0.5, rgb: [0.102, 0.059, 0.2], alpha: 0.18 }, // #1A0F33
  { offset: 0.56, rgb: [0.478, 0.118, 0.149], alpha: 0.45 }, // #7A1E26
  { offset: 0.68, rgb: [1.0, 0.239, 0.165], alpha: 1.0 }, // #FF3D2A
  { offset: 1.0, rgb: [1.0, 0.302, 0.239], alpha: 1.0 }, // #FF4D3D
];

/**
 * CPU twin of the GLSL gradient: returns the alpha-premultiplied color at
 * offset t in [0,1]. Premultiplying folds the dark center stops toward black so
 * the hub reads as an empty void, matching the SVG.
 */
export function gradientAt(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  let lo = GRADIENT_STOPS[0];
  let hi = GRADIENT_STOPS[GRADIENT_STOPS.length - 1];
  for (let i = 0; i < GRADIENT_STOPS.length - 1; i++) {
    if (x >= GRADIENT_STOPS[i].offset && x <= GRADIENT_STOPS[i + 1].offset) {
      lo = GRADIENT_STOPS[i];
      hi = GRADIENT_STOPS[i + 1];
      break;
    }
  }
  const span = hi.offset - lo.offset || 1;
  const f = (x - lo.offset) / span;
  return [0, 1, 2].map((c) => {
    const loC = lo.rgb[c] * lo.alpha;
    const hiC = hi.rgb[c] * hi.alpha;
    return loC + (hiC - loC) * f;
  }) as [number, number, number];
}

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

/** Data-node rotation angles in degrees (used by the SVG mark). */
export function dataNodeAngles() {
  return Array.from({ length: DATA_NODES.count }, (_, i) => (i / DATA_NODES.count) * 360);
}

/** Gauge-tick rotation angles in degrees (used by the SVG mark). */
export function gaugeTickAngles() {
  const step = (GAUGE.toDeg - GAUGE.fromDeg) / (GAUGE.count - 1);
  return Array.from({ length: GAUGE.count }, (_, i) => GAUGE.fromDeg + i * step);
}

export type PyrusMarkRing = {
  color: string;
  radius: number;
  tube: number;
};

// Compatibility for the app's lightweight direct-Three fallback scene. The
// source brand kit uses the richer constants above; this keeps the existing
// local 3D mark wrapper compiling without pulling in React Three Fiber.
export const PYRUS_MARK_RINGS: readonly PyrusMarkRing[] = [
  { color: "#168BFF", radius: 0.82, tube: 0.018 },
  { color: "#A14DFF", radius: 0.56, tube: 0.016 },
  { color: "#FF3048", radius: 0.3, tube: 0.014 },
] as const;
