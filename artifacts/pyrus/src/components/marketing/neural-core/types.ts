import type { CSSProperties } from "react";

/**
 * NeuralCore - an animated ASCII particle sphere on a transparent canvas.
 * Original recreation derived from observing public visual behavior; not vendored
 * from any paid component.
 */
export interface NeuralCoreProps {
  mode?: "cpu" | "gpu"; // default "gpu"
  coreColor?: string; // inner color (Pyrus blue by default)
  outerColor?: string; // outer color (Pyrus red by default)
  look?: "balanced" | "neon" | "soft"; // default "balanced"
  particles?: number; // 14000
  orbitCount?: number; // 3500
  radius?: number; // 2.2
  particleSize?: number; // 2.4
  distortion?: number; // 0.55 (0..1)
  noiseSpeed?: number; // 0.25
  rotationSpeed?: number; // 0.12 (rad/s)
  tiltStrength?: number; // 0.35
  coreOpacity?: number; // 0.9
  orbitOpacity?: number; // 0.8
  charSet?: "binary" | "hex" | "glyphs"; // "binary"
  // --- morph: loop the dots into the logo's concentric rings and back ---
  morph?: boolean; // default false (pure sphere)
  morphCycleMs?: number; // full loop: neural -> rings -> neural (9000)
  morphStagger?: number; // 0..1 spread of per-particle morph timing (0.4)
  ringScale?: number; // dot-ring radius as a multiple of sphere radius (1.15)
  // Form the full stacked LOCKUP (ring mark above the PYRUS wordmark) instead of
  // just the ring, so a fraction of the dots fall to the wordmark below. Default
  // false (ring only). The splash opts in so the cloud distills the whole logo.
  lockup?: boolean; // false
  // With lockup: form ONLY the ring mark (word points dropped, mark recentered
  // + fit so the rim radius == radius*ringScale). For surfaces whose wordmark
  // lives beside the mark as its own element (the header logo).
  lockupMarkOnly?: boolean; // false
  // Per-particle alpha floor at FULL ring convergence (additive blowout guard).
  // Default 0.13 reads well for light/medium surfaces; very dense surfaces (the
  // splash: tens of thousands of specks on tiny rings) must drop this much lower
  // (~0.045) so the dense crystallize never sums to a white blob. Independent of
  // coreOpacity, so the MIST phase can stay bright while convergence stays clean.
  convergeFloor?: number; // 0.13
  // Convergence-taper WINDOW (smoothstep over per-particle vConverge) that ramps
  // per-speck alpha from full down to convergeFloor. The additive pile-up peaks
  // MID-convergence (~0.6-0.8), so dense surfaces (the splash) must bottom out the
  // taper BEFORE that peak (e.g. 0.16 -> 0.54) or the rings still flash white at
  // the peak. Lighter surfaces hold bright rings later (default 0.34 -> 0.82) and
  // let the crisp logo resolve take over near the peak instead.
  convergeStart?: number; // 0.34
  convergeEnd?: number; // 0.82
  // Render resolution levers. superSample multiplies devicePixelRatio (true
  // supersampling -> crisper specks even on DPR<=2 desktops, where raising the cap
  // alone is a no-op); maxPixelRatio caps the result so weak/high-DPR phones don't
  // pay for a huge buffer. One-shot surfaces (the splash) can afford more.
  superSample?: number; // 1
  maxPixelRatio?: number; // 2.5
  // MSAA on the WebGL context. Default true (crisp one-shot surfaces). Ambient
  // background surfaces can set false to drop the multisample buffer cost.
  antialias?: boolean; // true
  // Per-speck glow skirt intensity. Lower = a razor-sharp disc with little haze;
  // the soft reference bloom is ~0.05 (the default). Dense surfaces read sharper
  // at a near-zero value since overlapping skirts otherwise sum into a haze.
  glow?: number; // 0.05
  // Render the dots as OPAQUE, depth-buffered, occluding points (no additive
  // blending) so front dots cover back dots - sharp, discrete specks instead of
  // a summed translucent glow. Supersampling AA's the hard edges. Default false
  // (the soft additive nebula). The splash uses true for a crisp particle sphere.
  crisp?: boolean; // false
  // With crisp: render the CLOUD phase as the soft ADDITIVE nebula (the auth
  // lockup's look) and crossfade to the crisp occluding dots as the mark forms
  // (m ~0.55-0.85) - nebula texture while dispersed, razor logo when formed.
  // Costs a second draw of the same geometry only during the crossfade.
  nebulaCloud?: boolean; // false
  // Organic-bloom trajectory: dots curl + drift along the cloud<->ring journey
  // (a flowing bloom out / a curling gather in when reversed) instead of a
  // straight lerp. bloom 0..1 mixes it in; swirl/turb scale the curl + noise.
  // Default off, so non-bloom surfaces are unchanged. The splash + hero opt in.
  bloom?: number; // 0
  swirl?: number; // 0.55
  turb?: number; // 0.4
  // Inflow VORTEX: dots converge toward a target rotated by vortex*(1-pm), which
  // unwinds to 0 as they land - so they spiral INWARD into the logo. 0 = off.
  vortex?: number; // 0
  // Stray-tendril reach multiplier: ~12% of seeds fly FAR past the cloud body as
  // wispy nebula strays (up to ~1.45x radius extra). 1 = reference look; tight
  // surfaces (the header logo) dial it down so the cloud stays compact.
  stray?: number; // 1
  // --- ambient "dreamy" drift levers (all default 0/off; gated like bloom so the
  // shared loader/hero surfaces render byte-identical - only NeuralBackdrop opts in) ---
  // Domain warp: displace the noise SAMPLE position by a low-frequency noise field
  // (one extra snoise tap) so the surface undulates like slow liquid instead of
  // buzzing octaves. The single biggest "fluid" upgrade. Default 0 = unchanged.
  warp?: number; // 0
  warpScale?: number; // 0.9  warp spatial frequency
  warpSpeed?: number; // 0.25 warp time rate (relative to t)
  // Breathing: a slow global radius swell so the whole cloud feels alive.
  breath?: number; // 0    (e.g. 0.022 = ~2.2% swell)
  breathSpeed?: number; // 0.4
  // Per-speck slow alpha twinkle (additive path only; sin of uTime + per-seed phase).
  shimmer?: number; // 0
  shimmerSpeed?: number; // 1.5
  // Orbit-layer noise time scale (was hardcoded 0.9); lowering it widens the
  // parallax between the two layers so the motion never reads as one rigid field.
  orbitTimeScale?: number; // 0.9
  // Whole-group lateral/vertical parallax drift (JS, absolute sin(t) - FR-independent).
  driftX?: number; // 0
  driftY?: number; // 0
  // Frame-rate cap (0 = uncapped/native). The ambient backdrop is a slow drift,
  // so rendering it at the full display refresh is wasted GPU that scrolling
  // wants back - cap it (e.g. 30) to roughly halve its constant cost. Bounded
  // one-shot surfaces (splash/hero morph) leave this 0 for full smoothness.
  maxFps?: number; // 0
  // External per-frame drive (e.g. the hero loop). When set, its `.current`
  // overrides the internal morph clock: morph 0..1 and scatter 0..1 (radial
  // burst). Mutated every frame by the owner; excluded from the re-init key so
  // updating it does NOT rebuild the WebGL scene.
  morphDriveRef?: { current: { morph: number; scatter: number } };
  className?: string;
  style?: CSSProperties;
}
