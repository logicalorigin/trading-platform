// Runtime particle-cloud geometry for the neural loading screen.
//
// We do NOT ship a baked point cloud (the marketing kit's 2.2 MB
// `pyrus-logo-points.ts` is not in this repo and there is no logo vector to
// sample). Instead we generate the morph target at runtime: draw the PYRUS
// lockup (a procedural concentric-ring mark + the "PYRUS" wordmark) onto an
// offscreen 2D canvas, read the pixels, and sample N points from the opaque
// coverage. Everything here is pure data (Float32Array) with NO `three`
// import, so it tree-splits cleanly into the lazy `neural` chunk.

// Deterministic PRNG so the cloud is stable across runs and screenshots.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Evenly distributed points on a unit sphere (the drifting "loading" cloud).
export function fibonacciSphere(count: number, radius = 1): Float32Array {
  const out = new Float32Array(count * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / Math.max(1, count - 1)) * 2; // 1 → -1
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    out[i * 3] = Math.cos(theta) * r * radius;
    out[i * 3 + 1] = y * radius;
    out[i * 3 + 2] = Math.sin(theta) * r * radius;
  }
  return out;
}

async function ensureFontsReady(timeoutMs: number): Promise<void> {
  if (typeof document === "undefined") return;
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  try {
    // Make sure the exact weight/size we draw with is loaded, not a system
    // fallback (sampling a fallback glyph would produce the wrong shape).
    fonts.load?.('700 110px "IBM Plex Sans"');
    await Promise.race([
      fonts.ready,
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch {
    // Best effort — fall through and sample whatever is available.
  }
}

type LogoTargetOptions = {
  count: number;
  seed?: number;
  fontTimeoutMs?: number;
  // "lockup" (default) = ring mark + PYRUS wordmark (expanded opener).
  // "mark" = concentric-ring mark only, centered + enlarged (tight loader).
  variant?: "lockup" | "mark";
};

// Draws the PYRUS lockup (or mark-only) to an offscreen canvas and samples
// `count` points from its opaque coverage, normalized to a centered, y-up
// space with a little z jitter so the formed logo has depth. Falls back to a
// sphere if 2D canvas sampling is unavailable.
export async function sampleLogoTargets(
  options: LogoTargetOptions,
): Promise<Float32Array> {
  const count = Math.max(1, Math.floor(options.count));
  const seed = options.seed ?? 0x9e3779b9;
  const variant = options.variant ?? "lockup";
  const rng = mulberry32(seed);

  if (typeof document === "undefined") {
    return fibonacciSphere(count, 0.9);
  }

  // Only the lockup needs the wordmark font; the mark is pure geometry.
  if (variant === "lockup") {
    await ensureFontsReady(options.fontTimeoutMs ?? 400);
  }

  const W = variant === "mark" ? 480 : 640;
  const H = variant === "mark" ? 480 : 460;
  const HALF_H = H / 2;

  let data: Uint8ClampedArray | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fibonacciSphere(count, 0.9);

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";

    if (variant === "mark") {
      // Centered, enlarged concentric-ring mark that fills the frame.
      const markCx = W / 2;
      const markCy = H / 2;
      const ringRadii = [200, 134, 70];
      const ringWidths = [26, 19, 13];
      for (let i = 0; i < ringRadii.length; i++) {
        ctx.lineWidth = ringWidths[i];
        ctx.beginPath();
        ctx.arc(markCx, markCy, ringRadii[i], 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Concentric-ring mark in the upper third of the lockup.
      const markCx = W / 2;
      const markCy = H * 0.31;
      const ringRadii = [96, 64, 32];
      const ringWidths = [16, 12, 9];
      for (let i = 0; i < ringRadii.length; i++) {
        ctx.lineWidth = ringWidths[i];
        ctx.beginPath();
        ctx.arc(markCx, markCy, ringRadii[i], 0, Math.PI * 2);
        ctx.stroke();
      }

      // "PYRUS" wordmark in the lower portion.
      ctx.font = '700 112px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("PYRUS", W / 2, H * 0.74);
    }

    data = ctx.getImageData(0, 0, W, H).data;
  } catch {
    return fibonacciSphere(count, 0.9);
  }

  // Collect opaque pixels (every other pixel keeps the candidate pool sane).
  const candidates: number[] = [];
  for (let py = 0; py < H; py += 2) {
    for (let px = 0; px < W; px += 2) {
      const alpha = data[(py * W + px) * 4 + 3];
      if (alpha > 128) candidates.push(py * W + px);
    }
  }

  if (candidates.length === 0) {
    return fibonacciSphere(count, 0.9);
  }

  const out = new Float32Array(count * 3);
  const zJitter = 0.06;
  const scale = variant === "mark" ? 1.1 : 1.35;
  for (let i = 0; i < count; i++) {
    const pick = candidates[(rng() * candidates.length) | 0];
    const px = pick % W;
    const py = (pick / W) | 0;
    out[i * 3] = ((px - W / 2) / HALF_H) * scale;
    out[i * 3 + 1] = (-(py - HALF_H) / HALF_H) * scale;
    out[i * 3 + 2] = (rng() * 2 - 1) * zJitter;
  }
  return out;
}
