import { PYRUS_LOGO_PTS } from "./pyrus-logo-points-compact";

export const CHARSETS = {
  binary: "01",
  hex: "0123456789ABCDEF",
  glyphs: "+*.:=#%@",
} as const;

/** Render a charset into a glyph atlas (one cell per character). Returns the
 *  canvas, the cell count, and grid dimensions for UV lookup in shaders. */
export function makeGlyphAtlas(chars: string, cell = 64) {
  const count = chars.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const c = document.createElement("canvas");
  c.width = cols * cell;
  c.height = rows * cell;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.font = `bold ${Math.floor(cell * 0.7)}px "IBM Plex Sans", sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (let i = 0; i < count; i++) {
    const x = (i % cols) * cell + cell / 2;
    const y = Math.floor(i / cols) * cell + cell / 2;
    g.fillText(chars[i], x, y);
  }
  return { canvas: c, count, cols, rows };
}

/** Deterministic pseudo-random (no Math.random - keep builds reproducible). */
function hashRand(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Canonical STROKE of the ACTUAL Pyrus mark: ordered sample points along each
 * dot-able arc, in mark-fraction units (~[-0.94, 0.94]), math convention
 * (y-up, 0=+x). Mirrors lib/pyrus-mark-geometry.ts so the dots form the REAL
 * logo - dashed concentric rings (dots only on the dash runs), the rim, and the
 * distinctive partial gauge arc (-60..+60deg at the top) - not generic circles.
 *
 * Every point carries a SEGMENT id (a contiguous dash run / the rim / one gauge
 * tick). The even-resample below only interpolates WITHIN a segment, so it never
 * draws a chord across a dash gap, between rings, or between gauge ticks. Kept as
 * plain numbers so neural-core stays free of a `three`/geometry import.
 */
type StrokePt = { x: number; y: number; seg: number; spin: number };
// Per-element SPIN rate (rad/s) so each ring rotates INDEPENDENTLY like the real
// mark: a full turn in `durationS` seconds (2pi/durationS), negated for reverse
// direction; null duration = static (0). Values mirror RING_SPECS / RIM_DOTS in
// lib/pyrus-mark-geometry.ts.
const TAU = Math.PI * 2;
const spinRate = (durationS: number | null, reverse: boolean) =>
  durationS ? ((reverse ? -1 : 1) * TAU) / durationS : 0;
function pyrusMarkStroke(): StrokePt[] {
  const pts: StrokePt[] = [];
  let seg = 0;
  // [radius, dashLen, gapLen, durationS, reverse] from RING_SPECS.
  const rings: Array<[number, number, number, number | null, boolean]> = [
    [82, 10, 6, 26, true],
    [71, 1.5, 3, 34, false],
    [62, 0.8, 3, null, false],
    [50, 6, 4, 44, true],
    [40, 3, 3, 56, false],
    [30, 0.6, 2.4, null, false],
  ];
  const STEP = 0.5; // viewBox units (fine, arc-even base for the resample)
  for (const [r, dash, gap, durS, rev] of rings) {
    const spin = spinRate(durS, rev);
    const circ = 2 * Math.PI * r;
    const period = dash + gap;
    let prevOn = false;
    for (let s = 0; s < circ; s += STEP) {
      const on = s % period < dash;
      if (on && !prevOn) seg++; // each dash run is its own segment
      prevOn = on;
      if (on) {
        const a = s / r;
        pts.push({ x: (Math.cos(a) * r) / 100, y: (Math.sin(a) * r) / 100, seg, spin });
      }
    }
    seg++;
  }
  // Rim: 72 dots at r=94, durationS 18 (normal).
  seg++;
  const rimSpin = spinRate(18, false);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    pts.push({ x: Math.cos(a) * 0.94, y: Math.sin(a) * 0.94, seg, spin: rimSpin });
  }
  // Data nodes: 18 small nodes at r=94, durationS 22 (REVERSE) - a tiny cluster of
  // points per node so the dots read them (they spin opposite the rim at the same
  // radius, which the per-particle spin makes possible).
  const nodeSpin = spinRate(22, true);
  for (let i = 0; i < 18; i++) {
    seg++;
    const a = (i / 18) * Math.PI * 2;
    const cx = Math.cos(a) * 0.94;
    const cy = Math.sin(a) * 0.94;
    const tx = -Math.sin(a);
    const ty = Math.cos(a); // tangent along the ring
    for (let u = -1; u <= 1; u++) {
      for (let v = -1; v <= 1; v += 2) {
        pts.push({
          x: cx + tx * u * 0.02 + Math.cos(a) * v * 0.012,
          y: cy + ty * u * 0.02 + Math.sin(a) * v * 0.012,
          seg,
          spin: nodeSpin,
        });
      }
    }
  }
  // Gauge arc: 25 radial ticks (r55..r68) spanning -60..+60deg at the top; static.
  for (let i = 0; i < 25; i++) {
    seg++;
    const deg = -60 + (120 * i) / 24;
    const phi = ((90 - deg) * Math.PI) / 180; // SVG deg (cw from top) -> math angle
    for (let rr = 55; rr <= 68; rr += 2) {
      pts.push({ x: (Math.cos(phi) * rr) / 100, y: (Math.sin(phi) * rr) / 100, seg, spin: 0 });
    }
  }
  return pts;
}

/**
 * EXACTLY `count` ring slots, spread EVENLY along the mark. We RESAMPLE the
 * stroke (with within-segment interpolation) so every particle gets its OWN
 * distinct home on the rings - instead of the old ~count/n dots piling onto each
 * stroke point (90% hidden, and the pile-up that blew the convergence to white).
 * Per-segment budgets are proportional to each segment's length, so the mark's
 * feature balance (sparse rim, dense rings, the gauge) is preserved.
 */
function pyrusRingSlots(count: number): {
  pos: Array<[number, number]>;
  spin: number[];
} {
  const stroke = pyrusMarkStroke();
  const n = stroke.length;
  // Group the stroke into contiguous same-seg runs.
  const segs: StrokePt[][] = [];
  for (const p of stroke) {
    const last = segs[segs.length - 1];
    if (last && last[0].seg === p.seg) last.push(p);
    else segs.push([p]);
  }
  // Budget per segment proportional to its point count; distribute the rounding
  // leftover to the largest fractional parts so the total is EXACTLY `count`.
  const raw = segs.map((s) => (count * s.length) / n);
  const budgets = raw.map((r) => Math.floor(r));
  let leftover = count - budgets.reduce((a, b) => a + b, 0);
  const byFrac = raw
    .map((r, i) => ({ i, f: r - Math.floor(r) }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < leftover; k++) budgets[byFrac[k % byFrac.length].i]++;

  const pos: Array<[number, number]> = [];
  const spin: number[] = [];
  for (let si = 0; si < segs.length; si++) {
    const seg = segs[si];
    const budget = budgets[si];
    for (let j = 0; j < budget; j++) {
      // Even parameter along the segment polyline.
      const f = seg.length === 1 ? 0 : (j / Math.max(budget - 1, 1)) * (seg.length - 1);
      const i = Math.min(Math.floor(f), seg.length - 1);
      const a = seg[i];
      const b = seg[Math.min(i + 1, seg.length - 1)];
      const frac = f - i;
      pos.push([a.x + (b.x - a.x) * frac, a.y + (b.y - a.y) * frac]);
      spin.push(a.spin); // spin is constant within a segment (one ring/element)
    }
  }
  return { pos, spin };
}

/**
 * Per-particle TARGET positions that lay the particles onto the Pyrus MARK. The
 * RING is the anchor: `count` evenly-spread slots (1:1 with particles). Pairing
 * is RADIAL BY ANGLE - a dot at azimuth phi on the sphere takes the ring slot at
 * the same angular rank, so each dot flies straight out along its own angle. The
 * loader plays this in reverse: the cloud DISTILLING cleanly into the rings, no
 * scramble and no pile-up.
 *
 * `dirs` are the particles' sphere directions (same index order as the geometry)
 * so we can match by projected (XY) angle. Positions are in world units (mark
 * scaled by `scale`), in the camera-facing z~0 plane so the mark faces forward.
 */
export function ringTargets(dirs: Float32Array, scale: number): Float32Array {
  const count = (dirs.length / 3) | 0;

  // Exactly `count` ring slots, in angular order (the anchor). Non-lockup ring
  // doesn't spin per-ring, so the slot spin is ignored here.
  const slotsByAngle = pyrusRingSlots(count)
    .pos.map((p) => ({ p, a: Math.atan2(p[1], p[0]) }))
    .sort((x, y) => x.a - y.a)
    .map((e) => e.p);

  // Particle indices in order of their projected (XY) sphere angle.
  const partByAngle = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const aa = Math.atan2(dirs[a * 3 + 1], dirs[a * 3]);
    const ab = Math.atan2(dirs[b * 3 + 1], dirs[b * 3]);
    return aa - ab;
  });

  // Rank-to-rank: the k-th angular particle takes the k-th angular ring slot, so
  // every slot is used exactly once and the dot travels at (roughly) its angle.
  const out = new Float32Array(count * 3);
  for (let rank = 0; rank < count; rank++) {
    const i = partByAngle[rank];
    const [px, py] = slotsByAngle[rank];
    // Tiny jitter keeps the dense rings organic without fuzzing them.
    const jx = (hashRand(i * 1.1 + 0.3) - 0.5) * 0.004;
    const jy = (hashRand(i * 2.3 + 0.7) - 0.5) * 0.004;
    out[i * 3] = (px + jx) * scale;
    out[i * 3 + 1] = (py + jy) * scale;
    out[i * 3 + 2] = (hashRand(i * 5.33 + 1.7) - 0.5) * 0.012 * scale;
  }
  return out;
}

/**
 * LOCKUP targets: the dots form the Pyrus MARK (ring) above the PYRUS WORDMARK,
 * matching the stacked brand lockup. A fraction `wordFrac` of the particles -
 * the ones facing DOWNWARD on the sphere - fall to the wordmark below; the rest
 * crystallize into the ring above (shifted up + scaled to leave room). Both sets
 * keep a coherent settle (ring by angle, word left->right) so nothing scrambles.
 * Same scale contract as `ringTargets`, so call sites swap one for the other.
 */
// Maps the sampled-logo's normalized x (==mark radius ~1) onto the engine's mark
// radius. The wordmark sits a clean gap below the mark in the sampled cloud.
const RING_S = 0.66;

// Word detection on a raw PYRUS_LOGO_PTS entry: the word is WHITE/neutral while
// the mark is saturated blue/red, and the word band overlaps the rim's y-range -
// so classify by color + y, never pure y. (Shared by lockupTargets' per-particle
// classification and the markOnly pre-filter.)
const isWordPt = (pt: readonly [number, number, number, number, number]) => {
  const mx = Math.max(pt[2], pt[3], pt[4]);
  const mn = Math.min(pt[2], pt[3], pt[4]);
  return pt[1] < -0.6 && mx - mn < 0.12 && mx > 0.3;
};

export function lockupTargets(
  dirs: Float32Array,
  scale: number,
  markOnly = false,
): {
  positions: Float32Array;
  spins: Float32Array;
  colors: Float32Array;
  wordFill: Float32Array;
  centerY: number;
  halfW: number;
} {
  const count = (dirs.length / 3) | 0;
  // The REAL logo, sampled to a colored point cloud (mark + wordmark) - NOT a
  // hand-coded ring rendition. Each particle flies to one of these points and
  // takes its color, so the assembled dots ARE the actual logo, in true color.
  // markOnly (header-size surfaces with their own wordmark beside the mark):
  // drop the word points and form JUST the ring mark, recentered on the mark
  // center and fit so the rim radius == `scale` (the full box, like the SVG
  // mark) instead of the stacked-lockup's 0.66 sub-fit.
  const pts = markOnly ? PYRUS_LOGO_PTS.filter((p) => !isWordPt(p)) : PYRUS_LOGO_PTS;
  const n = pts.length;
  // pts x is normalized to [-1,1] over the lockup width (== the mark diameter),
  // so the mark radius is ~1; FIT maps it onto the engine's mark radius (RING_S).
  const FIT = markOnly ? 1 / 0.985 : RING_S;

  // Mark center + ring radii: EXACT constants of the committed PYRUS_LOGO_PTS
  // cloud (fit to the image-sampled REAL logo artwork, .cap/out/logopts.json -
  // concentric-center peakiness search + the radial histogram's 7 clean bands).
  // NEVER estimate these at runtime: a centroid/max-radius estimate is pulled
  // off-center by sampling asymmetry, so measured radii smear across spin bands
  // - the rim split between forward and REVERSE rates and sheared apart by
  // form-time. Exact center + exact radii = every dot of a ring banded together
  // = rigid rings. RESAMPLING the artwork means refreshing these constants.
  const MARK_CX = 0.0, MARK_CY = 0.05;
  // [ring radius (normalized), spin rad/s] - rates by rank as in the animated
  // mark: rim forward 18s, bold arc reverse 26s, then 34s/static/44s/56s/static.
  const RING_SPIN: ReadonlyArray<readonly [number, number]> = [
    [0.985, (2 * Math.PI) / 18],
    [0.855, -(2 * Math.PI) / 26],
    [0.745, (2 * Math.PI) / 34],
    [0.65, 0],
    [0.525, -(2 * Math.PI) / 44],
    [0.42, (2 * Math.PI) / 56],
    [0.315, 0],
  ];
  const spinFor = (rr: number): number => {
    let best = RING_SPIN[0], bd = Infinity;
    for (const e of RING_SPIN) {
      const d = Math.abs(e[0] - rr);
      if (d < bd) { bd = d; best = e; }
    }
    return best[1];
  };

  // Angular-coherent assignment: order BOTH the logo points and the particles by
  // angle, so the cloud settles RADIALLY into the mark (dots spiral into their
  // places, minimal path-crossing) instead of scrambling.
  const ptOrder = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) =>
      Math.atan2(pts[a][1], pts[a][0]) - Math.atan2(pts[b][1], pts[b][0]),
  );
  const pOrder = Array.from({ length: count }, (_, i) => i).sort((a, b) => {
    const aa = Math.atan2(dirs[a * 3 + 1], dirs[a * 3]);
    const ab = Math.atan2(dirs[b * 3 + 1], dirs[b * 3]);
    return aa - ab;
  });

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const spins = new Float32Array(count); // per-ring spin set below; wordmark stays static
  // 1 for wordmark particles (the thin "PYRUS" letter strokes need extra fill so
  // they fuse SOLID like the bold arcs); 0 for the mark.
  const wordFill = new Float32Array(count);
  for (let r = 0; r < count; r++) {
    const i = pOrder[r];
    // Spread particles across all logo points proportionally + angle-aligned; when
    // there are more particles than points, extras just add density (with jitter).
    const pt = pts[ptOrder[Math.floor((r * n) / count) % n]];
    // MINIMAL jitter - the dots land almost exactly on the sampled logo pixels so
    // the formed strokes read as SMOOTH, crisp lines (no granular scatter off the
    // stroke). Extra particles stack on the same pixels, which only sharpens.
    const jx = (hashRand(i * 1.1 + 0.3) - 0.5) * 0.0008;
    const jy = (hashRand(i * 2.3 + 0.7) - 0.5) * 0.0008;
    // Wordmark detection: in the REAL artwork's layout the word band (y -0.85..
    // -1.03) OVERLAPS the rim's y-range, so a pure y split misclassifies both
    // ways (word rows would spin, rim-bottom dots would whiten+grow). The word
    // is WHITE/neutral while the mark is saturated blue/red (dark-split dashes
    // are dim, below the whiteness floor) - so classify by color + y (isWordPt;
    // markOnly already filtered word points out, so it's always false there).
    const isWord = !markOnly && isWordPt(pt);
    // markOnly recenters on the mark center so the ring mark sits centered in
    // the box (the stacked lockup keeps the artwork's layout offsets instead).
    const ox = markOnly ? MARK_CX : 0;
    const oy = markOnly ? MARK_CY : 0;
    positions[i * 3] = ((pt[0] - ox) * FIT + jx) * scale;
    positions[i * 3 + 1] = ((pt[1] - oy) * FIT + jy) * scale;
    positions[i * 3 + 2] = (hashRand(i * 5.33 + 1.7) - 0.5) * 0.0015 * scale; // near-flat: dots sit on ~one plane so the dense rings read as crisp lines (tiny z keeps the depth buffer from z-fighting in crisp mode)
    colors[i * 3] = pt[2];
    colors[i * 3 + 1] = pt[3];
    colors[i * 3 + 2] = pt[4];
    wordFill[i] = isWord ? 1 : 0;
    // Each ring rotates independently at its real rate; the wordmark stays put.
    if (!isWord) {
      const rr = Math.hypot(pt[0] - MARK_CX, pt[1] - MARK_CY);
      // Dim word-edge pixels fall below the whiteness floor and land here; in
      // the word band they must NOT inherit a ring spin (they'd drift off the
      // letters). Only true rim / bold-arc dots down there rotate.
      const inWordBand = pt[1] < -0.82 && Math.abs(pt[0]) < 0.78;
      spins[i] =
        inWordBand && Math.abs(rr - 0.985) > 0.04 && Math.abs(rr - 0.855) > 0.05
          ? 0
          : spinFor(rr);
    }
  }
  // pivot the ring rotation about the real mark center (not the bbox origin);
  // markOnly recentered the mark on the origin, so its pivot is y=0. halfW =
  // the brand gradient's half-span in world units (the rim radius) -> the
  // FIXED horizontal gradient the spinning rings rotate THROUGH (so blue
  // stays left / red stays right, like the real logo - the baked per-dot color
  // would otherwise rotate with the dot and scramble the gradient).
  return {
    positions,
    spins,
    colors,
    wordFill,
    centerY: markOnly ? 0 : MARK_CY * FIT * scale,
    halfW: 0.985 * FIT * scale,
  };
}

/** Fibonacci-sphere unit directions, with a little per-particle jitter so the
 *  cloud reads ORGANIC (like the reference nebula) instead of showing regular
 *  dot-rows / the spiral lattice when the sphere is large / zoomed in. */
export function fibonacciSphere(count: number): Float32Array {
  const dirs = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  const J = 0.045; // jitter magnitude (fraction of unit radius)
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    // Perturb the direction then renormalize - breaks the lattice without
    // collapsing the spherical distribution.
    const x = Math.cos(th) * r + (hashRand(i * 1.3 + 0.9) - 0.5) * J;
    const yy = y + (hashRand(i * 2.7 + 0.2) - 0.5) * J;
    const z = Math.sin(th) * r + (hashRand(i * 4.1 + 0.5) - 0.5) * J;
    const len = Math.hypot(x, yy, z) || 1;
    dirs[i * 3] = x / len;
    dirs[i * 3 + 1] = yy / len;
    dirs[i * 3 + 2] = z / len;
  }
  return dirs;
}
