import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { canUseWebGL } from "@/components/marketing/pyrus-mark-3d";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

/**
 * NeuralStage - the first-load OPENING (the page loader), NOT the background.
 *
 * It renders the SAME full-viewport neural cloud as the ambient NeuralBackdrop
 * (identical params + geometry, so the opening cloud has the same width/spread),
 * but driven by a morph: the cloud holds, then the dots THEMSELVES fly to their
 * places and FORM the Pyrus logo (ring + PYRUS wordmark) - there is no crisp SVG;
 * the dots are the logo, and they stay visible as they assemble (convergeFloor is
 * high). The logo holds, the dots disperse back into the cloud, and the whole
 * overlay cross-dissolves into the persistent backdrop behind it - only THEN do
 * the site elements appear.
 *
 * Plays once per entry-page load (home or auth); a no-op everywhere else.
 */

const CLOUD_HOLD_MS = 1500; // the dispersed-cloud opening frame (stage 1). This is
// VISIBLE cloud time - do NOT trim it to "remove black"; the black is the
// pre-three-load gap BEFORE this (addressed by pre-bundling three), not here.
// Cutting this just clips the opening cloud stage.
const TO_LOGO_MS = 3600; // dots spiral inward + fuse into the logo (trimmed 4200->3600)
const LOGO_HOLD_MS = 1100; // logo holds (trimmed 1500->1100)
const TO_CLOUD_MS = 2200; // dots fly back out into the cloud (trimmed 2600->2200)
const FADE_MS = 900; // overlay cross-dissolves into the ambient backdrop (gentle, fluid)
const MAX_WAIT_MS = 12000; // backstop from three-load if content never readies (must exceed CLOUD_HOLD + TO_LOGO + LOGO_HOLD)
// Failsafe: three.js is a LAZY dynamic import whose resolution sets `threeAt`,
// and the entire morph clock is measured from `threeAt`. If that chunk is slow
// or STALLS (pending - never resolving AND never rejecting, e.g. a wedged proxy
// or a cold deploy), the clock never advances and this overlay sits over
// fully-ready content forever - the historical "loads to a blank/white screen".
// So if three hasn't resolved within this budget, start the clock anyway.
const THREE_BUDGET_MS = 3500;
// Absolute upper bound, measured from page load and INDEPENDENT of three: the
// overlay always begins leaving by here no matter what. Sits above the synthetic
// path's natural finish (THREE_BUDGET + CLOUD + TO_LOGO + LOGO_HOLD + TO_CLOUD).
const HARD_CAP_MS = 13000;
const ENTRY_PATHS = new Set(["/", "/app/login"]);

// Same particle look + full-viewport geometry as the ambient NeuralBackdrop (so
// the opening cloud has the SAME width/spread), PLUS the morph + lockup that fly
// the dots into the logo. The dots are the logo (no crisp SVG): they hold most of
// their brightness through convergence (convergeFloor high) so you watch them
// assemble - only a light taper so the dense lines don't blow out to white.
const STAGE_PROPS = {
  particles: 80000,
  orbitCount: 28000,
  particleSize: 0.02, // tiny ~1px specks; density (not blob growth) gives crispness. 80k still packs the ~40k sampled points ~2x into solid strokes (verified visually indistinguishable from 120k); a one-shot overlay, so this is purely init cost + headroom (280k + 2x supersample + MSAA once lost the context -> the "stuck haze")
  coreOpacity: 0.95,
  orbitOpacity: 0.7,
  distortion: 0.62,
  noiseSpeed: 0.07,
  rotationSpeed: 0.018,
  tiltStrength: 0.15,
  glow: 0.05, // small skirt: sharper dot edges (crisper rings) while still reading particle-y
  warp: 0.16,
  warpScale: 0.9,
  warpSpeed: 0.2,
  shimmer: 0.1,
  shimmerSpeed: 1.3,
  orbitTimeScale: 0.78,
  superSample: 1, // NO supersample: 2x supersample was the GL-context killer
  maxPixelRatio: 2, // modest crispness headroom (was 1.75); 3 + supersample is what crashed
  // MSAA ON: in crisp mode the blend ignores fragment alpha, so the shader's
  // disc-edge AA needs alphaToCoverage -> MSAA to actually land. Without it
  // every dot is a binary pixel blob whose edges re-quantize per frame as the
  // rings spin = the "stray dot jitter" at the formed mark/word edges. MSAA
  // alone (no supersample, PR cap 2) is well below the 280k+2xSS+PR3 combo
  // that lost the GL context.
  antialias: true,
  maxFps: 60, // transient overlay: high-fps so the dot assembly is smooth
  radius: 3.1,
  // THE PARTICLES ARE THE REAL LOGO. lockupTargets sends each dot to a point
  // sampled from the ACTUAL rendered logo (pyrus-logo-points) and gives it that
  // pixel's true color, so the assembled cloud IS the real blue/red mark +
  // wordmark - no rendition, no crisp-SVG crossfade. `crisp` = OPAQUE/occluding
  // dots so the sampled colors render true (additive would wash them to white).
  lockup: true,
  ringScale: 0.42,
  crisp: true,
  // The dots hold full brightness AS the logo (they are the logo); the shader
  // fades each to its sampled logo color + full brightness on convergence.
  convergeFloor: 1.0,
  convergeStart: 0.5,
  convergeEnd: 0.95,
  // Inward VORTEX so the dots spiral into their logo positions (rotating ~1 turn
  // as they land) - the swirl-into-place reads as the cloud reshaping into the
  // logo, not a collapse to center.
  bloom: 0,
  vortex: 5.0,
  // Match the ambient NeuralBackdrop's dreamy breath + parallax drift so the
  // DISPERSED cloud moves identically to the backdrop at the hand-off. breath
  // only swells the sphere (never the formed mark), and drift is gated by `open`
  // in NeuralCore, so the logo itself stays still; the shared clock keeps both
  // clouds' breath/drift phase-locked -> the cross-dissolve reads as one cloud.
  breath: 0.022,
  breathSpeed: 0.33,
  driftX: 0.05,
  driftY: 0.04,
} as const;

// Same viewport vignette as the ambient backdrop, so the opening cloud's width
// reads identically (concentrated toward center, faded before the edges).
const STAGE_MASK_CLASS =
  "[mask-image:radial-gradient(125%_125%_at_50%_45%,#000_55%,transparent_100%)] [-webkit-mask-image:radial-gradient(125%_125%_at_50%_45%,#000_55%,transparent_100%)]";

const smooth = (x: number) => x * x * (3 - 2 * x);
const contentReady = () =>
  typeof window !== "undefined" &&
  (window as unknown as { __contentReady?: boolean }).__contentReady === true;
const hidePoster = () =>
  (window as unknown as { __hideSplash?: () => void }).__hideSplash?.();

// The hero keys its first-load loop restart off window.__splashHiding (see
// hero-workflow-demo's waitForReveal): when the opener starts revealing, the
// hero restarts at loopT 0 so the open beat - neural construct + "Market opens
// in 3·2·1" countdown - plays where the user can actually SEE it instead of
// hidden under this z-[100] overlay. The flag used to be set by the inline
// __hideSplash script in index.html; that poster was removed 2026-06-03, so
// NeuralStage now owns setting it on every reveal path.
const markSplashHiding = () => {
  (window as unknown as { __splashHiding?: boolean }).__splashHiding = true;
};

export function NeuralStage({ onReveal }: { onReveal: () => void }) {
  const [active, setActive] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const drive = useRef({ morph: 0, scatter: 0 });
  const crispRef = useRef<HTMLDivElement>(null); // the REAL logo that resolves in
  const dotsLayerRef = useRef<HTMLDivElement>(null); // the particle layer (fades as the crisp mark solidifies)

  useEffect(() => {
    const path = (window.location.pathname || "/").replace(/\/+$/, "") || "/";
    // Gate: in PRODUCTION the opener is a brand moment, not a per-reload tax -
    // play it once per tab session, every reload after skips straight to content.
    // In DEV it ALWAYS plays so we can actually see/tune it on every reload.
    // Read reduced-motion SYNCHRONOUSLY (not via usePrefersReducedMotion, which
    // returns its SSR-safe `true` default on first render then flips to false).
    // That transient `true` made this effect early-return on first mount -
    // calling onReveal() (and hidePoster()) ~0.5s BEFORE the real opener played,
    // flashing the page in early. The sync read runs the effect once, correctly.
    const prefersReduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    if (!import.meta.env.DEV) {
      try {
        seen = sessionStorage.getItem("pyrus_loader_seen") === "1";
      } catch {
        // sessionStorage unavailable (private mode / blocked) -> treat as unseen.
      }
    }
    if (!ENTRY_PATHS.has(path) || prefersReduced || !canUseWebGL() || seen) {
      hidePoster();
      markSplashHiding();
      onReveal();
      return;
    }
    try {
      sessionStorage.setItem("pyrus_loader_seen", "1");
    } catch {
      // ignore; worst case the opener replays next reload.
    }
    setActive(true);

    const startedAt = Date.now();
    let raf = 0;
    let threeAt = 0;
    let disperseAt = 0;
    let leaveStarted = false;
    // The logo has fully dispersed back into the cloud -> cross-dissolve the
    // overlay into the ambient backdrop (the SAME cloud), and ONLY when that
    // hand-off finishes do we reveal the site content over it.
    const startLeave = () => {
      if (leaveStarted) return;
      leaveStarted = true;
      // Reveal the site NOW (not after the fade) so the content fades IN while the
      // overlay fades OUT - a single crossfade (the site comes forward AS the
      // neural recedes into the backdrop), instead of a sequential out-then-in
      // with a bare-backdrop beat between them. Content has been ready since
      // before the dispersal (disperse is gated on contentReady), so this never
      // reveals onto a still-loading page.
      markSplashHiding();
      onReveal();
      setLeaving(true);
      window.setTimeout(() => {
        setActive(false);
      }, FADE_MS);
    };
    let posterHidden = false;
    import("@/components/marketing/neural-core-scene").then(
      () => {
        // Mark when three is ready, but DON'T hide the poster yet - the WebGL cloud
        // needs a couple frames to first-paint. Hiding now flashes an empty screen.
        // The tick hides the poster only after a short grace, once the cloud paints.
        threeAt = Date.now();
      },
      () => {
        hidePoster();
        startLeave();
      },
    );

    const tick = () => {
      const now = Date.now();
      // Failsafe: three's lazy import sets `threeAt` and starts the morph clock.
      // If the chunk is slow or STALLS (pending forever), the clock would never
      // advance and the overlay would freeze over fully-ready content. Once we've
      // waited the budget, start the clock anyway - the opener proceeds and
      // reveals (degrading to a brief dark beat if the cloud never paints).
      if (!threeAt && now - startedAt >= THREE_BUDGET_MS) threeAt = now;
      // Hide any pre-React poster once the cloud has actually painted (short grace
      // past three-load) so it doesn't linger over the live opener. (No-op unless a
      // poster wired window.__hideSplash.)
      if (threeAt && !posterHidden && now - threeAt >= 300) {
        posterHidden = true;
        hidePoster();
      }
      const mt = threeAt ? now - threeAt : 0;
      const t1 = CLOUD_HOLD_MS;
      const t2 = t1 + TO_LOGO_MS;
      const t3 = t2 + LOGO_HOLD_MS;

      // cloud(2s) -> dots form logo -> logo hold(2s, extends until ready) -> disperse
      let m: number;
      if (mt < t1) m = 0;
      else if (mt < t2) m = smooth((mt - t1) / TO_LOGO_MS);
      else if (!disperseAt) m = 1;
      else {
        const d = now - disperseAt;
        m = d < TO_CLOUD_MS ? 1 - smooth(d / TO_CLOUD_MS) : 0;
      }
      // DEV-only: pin the morph to window.__stageMorph (0..1) to study/tune the
      // cloud<->logo transition frame-by-frame, and freeze the auto-reveal so the
      // overlay holds for capture. Tree-shaken from the production build.
      let pinned = false;
      if (import.meta.env.DEV) {
        const f = (window as unknown as { __stageMorph?: number }).__stageMorph;
        if (typeof f === "number") {
          m = f;
          pinned = true;
        }
      }
      drive.current.morph = m;
      // NO overlay of any kind. The ENTIRE logo (mark + wordmark) is the dense tiny
      // particle field sampled one-per-pixel from the real logo - it reads crisp by
      // density. The crisp layer stays hidden; the dots stay at full.
      if (crispRef.current) crispRef.current.style.opacity = "0";
      if (dotsLayerRef.current) dotsLayerRef.current.style.opacity = "1";

      if (
        !pinned &&
        !disperseAt &&
        threeAt &&
        mt >= t3 &&
        (contentReady() || now - startedAt >= MAX_WAIT_MS)
      ) {
        disperseAt = now;
      }
      // Absolute failsafe: never let the overlay outlive HARD_CAP_MS. If we've
      // blown past it without starting to leave, jump straight into the
      // dispersal -> fade teardown (reuses the normal hand-off path below).
      if (!pinned && !leaveStarted && !disperseAt && now - startedAt >= HARD_CAP_MS) {
        disperseAt = now - TO_CLOUD_MS;
      }
      // Start the hand-off only AFTER the dots have FULLY dispersed back to cloud.
      if (disperseAt) {
        const d = now - disperseAt;
        if (!leaveStarted && d >= TO_CLOUD_MS) startLeave();
        if (leaveStarted && d >= TO_CLOUD_MS + FADE_MS) {
          raf = 0;
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [onReveal]);

  if (!active) return null;

  return (
    <div
      aria-hidden="true"
      className={`fixed inset-0 z-[100] bg-background transition-opacity duration-[900ms] ease-in-out ${
        leaving ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <div ref={dotsLayerRef} className={`pointer-events-none absolute inset-0 ${STAGE_MASK_CLASS}`}>
        <Suspense fallback={null}>
          <NeuralCoreScene {...STAGE_PROPS} morphDriveRef={drive} />
        </Suspense>
      </div>
      {/* The REAL logo: the actual PyrusMark SVG (real gradient + independently
          spinning rings) above the real wordmark. The dots resolve into this as
          they converge; it fades back out as they disperse. Positioned + sized to
          land where the dots converge (the lockup). */}
      <div
        ref={crispRef}
        className="pointer-events-none absolute inset-0"
        style={{ opacity: 0 }}
      >
        {/* No overlay - the dense particle field IS the whole logo (mark + text). */}
      </div>
    </div>
  );
}
