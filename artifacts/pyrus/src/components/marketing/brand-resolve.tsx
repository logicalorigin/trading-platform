/**
 * BrandResolve - the "logo resolves from the sphere" brand moment.
 *
 * Layers the NeuralCore particle sphere UNDER the PyrusMark3D logo and
 * crossfades between them (CSS, in index.css): the sphere fades in, then
 * contracts and fades out while the logo resolves in on top - reading as the
 * particle cloud condensing into the mark. The PYRUS wordmark (owned by
 * BrandLoader) fades up after.
 *
 * The sphere is the only added cost: it lazy-loads the `neural-core-scene`
 * chunk (three) and renders ONLY when motion is allowed and WebGL is available.
 * Otherwise this is just PyrusMark3D, which itself degrades to the SVG mark.
 * So reduced-motion / no-WebGL users get the existing static logo, untouched.
 */
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  PyrusMark3D,
  canUseWebGL,
  usePrefersReducedMotion,
} from "@/components/marketing/pyrus-mark-3d";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { PyrusMark } from "@/components/marketing/pyrus-mark";
import { isWebglAvailable } from "@/lib/webglCapability";
import { cn } from "@/lib/utils";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

/** Default sphere tuning for the loader's one-shot resolve (large ~420px box).
 *  Callers (e.g. the small header logo) override via the `sphereProps` prop. */
const DEFAULT_SPHERE: Partial<NeuralCoreProps> = {
  look: "balanced",
  particles: 7000,
  orbitCount: 2800,
  radius: 2.0,
  // particleSize is now a viewport-relative glyph fraction (size-independent),
  // so the same value reads at both the loader and the header.
  particleSize: 1.45,
  coreOpacity: 0.7,
  orbitOpacity: 0.48,
  distortion: 0.5,
  rotationSpeed: 0.18,
};

/** Defaults for the universal animated logo: the neural sphere looping into the
 *  Pyrus rings and back. Used wherever the logo animates (header, loader, login,
 *  404, ...); any call site can override via `sphereProps`. Soft blending keeps
 *  it from blowing out at small sizes; glyphs are viewport-proportional so the
 *  same values read from a 36px header to a 200px lockup. */
const DEFAULT_MORPH: Partial<NeuralCoreProps> = {
  // ADDITIVE blending (look "balanced"): overlapping specks add to a glow rather
  // than smearing into a translucent mush (which is what "soft"/normal blend did).
  // This is what gives the reference's sharp-bright-speck-with-bloom look.
  look: "balanced",
  // Reference parity: MANY tiny fine specks = a nebula/dust cloud, not a handful
  // of dots. Small additive specks don't mush, so we can pack thousands. The
  // resolve crossfades to the crisp SVG mark, so the dots don't have to BE the
  // rings - free to go small/sharp/dense like the reference particle sphere.
  particles: 14000,
  orbitCount: 5400,
  particleSize: 0.19,
  // Additive accumulates, so per-speck opacity is low to keep the denser core from
  // blowing out to a white blob - the depth shading then carries the volume.
  // (Trimmed slightly as the particle count rose so the denser cloud stays clean.)
  coreOpacity: 0.42,
  orbitOpacity: 0.28,
  distortion: 0.62,
  morphCycleMs: 9000,
  // The neural sphere overflows the box (canvas is larger - see sphereInset), so
  // the rings sit TIGHTER than the sphere: the dots expand out as the sphere then
  // converge IN to the box-sized logo. ringScale lands the ring rim ~the box edge.
  ringScale: 0.8,
};

/** If the sphere's WebGL scene throws, silently drop it - the logo still shows. */
class SphereBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BrandResolve({
  className,
  haloBlur,
  bloomBlur,
  loop = false,
  morph = false,
  morphDriveRef,
  sphereProps,
  sphereInsetClassName,
  logoVariant = "3d",
  openOnDots = false,
  sphereMask,
  suppressCrisp = false,
  dotsAreMark = false,
  webglPolicy = "supported",
}: {
  className?: string;
  haloBlur?: number;
  bloomBlur?: number;
  /** Loop the resolve forever (header logo) instead of playing once (loader). */
  loop?: boolean;
  /** Particle-morph mode: the sphere's OWN clock loops dots into the logo rings
   *  and back (pass morph:true in sphereProps too). The CSS bloom loop is
   *  dropped and the crisp logo becomes a faint guide behind the dotted mark. */
  morph?: boolean;
  /** External per-frame morph drive (e.g. the hero loop). Forwarded to the
   *  NeuralCore so the same component can be loop-clocked OR externally driven. */
  morphDriveRef?: NeuralCoreProps["morphDriveRef"];
  /** Override the sphere tuning - e.g. fewer particles for the tiny header. */
  sphereProps?: Partial<NeuralCoreProps>;
  /** Tailwind inset on the sphere layer. Defaults to inset-0 in morph mode (the
   *  canvas == the mark box, so the dotted mark aligns to the guide identically
   *  at every size) and to the large overflow for the one-shot loader. */
  sphereInsetClassName?: string;
  /** Logo layer: "3d" = PyrusMark3D (loader), "svg" = the lightweight SVG rings
   *  (header - keeps the mark crisp and avoids a second persistent canvas). */
  logoVariant?: "3d" | "svg";
  /** Open on the DOTS (neural mist), not the crisp logo. The crisp mark stays
   *  hidden until it crystallizes in at the morph peak. Used by the splash, where
   *  the mist IS the opening scene and something underneath (the static mist)
   *  covers the brief pre-dots load - so there's no need to hold the crisp mark. */
  openOnDots?: boolean;
  /** CSS mask-image applied to the dots layer - e.g. a radial fade so the large
   *  splash sphere dissolves into the void instead of clipping at the square
   *  canvas edge (a visible "box boundary"). */
  sphereMask?: string;
  /** Dev/audit: force the crisp logo layer hidden so the raw dotted mark is
   *  visible throughout the morph (the rAF otherwise crossfades it in). */
  suppressCrisp?: boolean;
  /** Opener-parity mode: the DOTS are the logo (true baked colors, crisp
   *  occluding specks) - never crossfade to the crisp layer at the morph peak.
   *  The crisp mark serves ONLY as the pre-load / no-WebGL fallback: it holds
   *  until the dots chunk reveals, then the particle rendition owns the moment
   *  (cloud -> formed spinning mark -> cloud) exactly like the page opener. */
  dotsAreMark?: boolean;
  /** "supported" keeps the stricter opener policy; loader surfaces can use any
   *  available WebGL context so they still show neural dots in software-rendered
   *  preview browsers. */
  webglPolicy?: "supported" | "available";
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Sphere only when it will actually animate and can render. Until mounted we
  // avoid the first-paint WebGL probe (matches PyrusMark3D).
  const webglReady =
    webglPolicy === "available" ? isWebglAvailable() : canUseWebGL();
  const showSphere = mounted && !reducedMotion && webglReady;
  // morph: the canvas overflows the box so the neural sphere EXPANDS beyond the
  // boundary, then converges into the box-sized mark. Percentage inset scales
  // with the box, so it's consistent at every size.
  const sphereInset =
    sphereInsetClassName ?? (morph ? "-inset-[45%]" : "-inset-[170px]");

  // Crossfade the dots INTO the real crisp PyrusMark as the morph resolves
  // (m -> 1), and back to dots as it scatters / returns to the sphere. For
  // internal-clock surfaces BrandResolve also runs the cycle here and feeds
  // NeuralCore via `internalDrive`, so the dots and the crisp logo stay in sync.
  const dotsRef = useRef<HTMLDivElement>(null);
  const crispRef = useRef<HTMLDivElement>(null);
  const internalDrive = useRef({ morph: 0, scatter: 0 });
  const dotsReadyRef = useRef(false);
  // openOnDots only: after a grace window with the dots still not loaded, fall
  // back to the crisp mark. Within the grace window we show NOTHING (the mist
  // behind covers it) so a normal load opens straight on the neural - no crisp
  // logo flashing in and fading out before the dots arrive.
  const fallbackRef = useRef(false);
  const drive = morphDriveRef ?? internalDrive;
  const cycleMs = sphereProps?.morphCycleMs ?? DEFAULT_MORPH.morphCycleMs ?? 9000;

  useEffect(() => {
    if (!showSphere || !morph) return;
    // Until the dots chunk is ready the crisp mark stays up (no blank flash),
    // then the dots fade IN over it - smooth in, no pop.
    dotsReadyRef.current = false;
    fallbackRef.current = false;
    let alive = true;
    const markReady = () => {
      if (alive) dotsReadyRef.current = true;
    };
    // Fall back to the crisp mark ONLY if the dots chunk genuinely FAILS to load -
    // never on a blind timer. A slow (but eventual) load must keep showing the dark
    // poster underneath and then open straight on the neural; flashing the crisp
    // ring in while the chunk was still downloading produced a visible
    // ring -> neural -> ring sequence on cold loads. A true network hang (promise
    // never settles) is covered by the splash's own MAX_WAIT reveal, so the worst
    // case is a dark glow, never a ring that pops in and out.
    const markFailed = () => {
      if (alive) fallbackRef.current = true;
    };
    import("@/components/marketing/neural-core-scene").then(markReady, markFailed);

    const start = Date.now();
    let raf = 0;
    let revealStart = 0;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const tick = () => {
      const now = Date.now();
      let m: number;
      let scatter: number;
      if (morphDriveRef) {
        m = morphDriveRef.current.morph;
        scatter = morphDriveRef.current.scatter;
      } else {
        const tt = ((now - start) % cycleMs) / cycleMs;
        if (tt < 0.3) m = 0;
        else if (tt < 0.45) m = ease((tt - 0.3) / 0.15);
        else if (tt < 0.72) m = 1;
        else if (tt < 0.88) m = 1 - ease((tt - 0.72) / 0.16);
        else m = 0;
        scatter = 0;
        internalDrive.current.morph = m;
        internalDrive.current.scatter = 0;
      }
      // DEV-only: pin the morph to window.__morphForce (0..1) to study/tune the
      // transition frame-by-frame. Tree-shaken from the production build.
      if (import.meta.env.DEV) {
        const f = (window as unknown as { __morphForce?: number }).__morphForce;
        if (typeof f === "number") {
          m = f;
          scatter =
            (window as unknown as { __scatterForce?: number }).__scatterForce ?? 0;
          drive.current.morph = m;
          drive.current.scatter = scatter;
        }
      }
      // Smooth one-time reveal of the dots once their chunk is ready.
      if (dotsReadyRef.current && revealStart === 0) revealStart = now;
      const reveal =
        revealStart === 0 ? 0 : ease(Math.min((now - revealStart) / 280, 1));
      // Crisp resolves in and dims the dots (via 1-resolveAmt below). Two timings:
      // - openOnDots (splash, very dense dots on tiny rings): crossfade EARLY so
      //   the crisp covers the dense final crystallize before it blows out white.
      // - otherwise (404/header/hero): the dots settle into clean rings by ~0.82,
      //   so crossfade AFTER that, over the formed rings - seamless, no crisp-over-
      //   converging-spokes mismatch.
      // Backs off while scattering (the dots are what disperse).
      const peak = openOnDots
        ? // Crisp rings fade IN as the dots converge/dim, filling the window where
          //   the dots taper out so total luminance stays smooth - no dim "mist ->
          //   black -> logo" trough. Starts as soon as convergence begins (~m .30)
          //   and is FULL by ~.54, well before the dots' dense pile-up peak
          //   (vConverge ~.6-.8) - so the crisp covers + hides the dots before they
          //   would blow out white, which in turn lets the still-visible converging
          //   dots stay BRIGHT (high convergeFloor) through the valley.
          Math.max(0, Math.min(1, (m - 0.3) / 0.24))
        : Math.max(0, Math.min(1, (m - 0.8) / 0.18));
      const resolveAmt = ease(peak) * (1 - Math.max(0, Math.min(1, scatter)));
      // Blend. Default: crisp held until the dots reveal, then crossfade (no
      // blank flash on surfaces with nothing behind them). openOnDots (splash):
      // the dots/mist are the opening and the crisp mark CRYSTALLIZES in only at
      // the peak - BUT if the dots chunk (three) is slow, fall back to the crisp
      // mark so a slow load shows the logo, never just an empty mist.
      // suppressCrisp (dev/audit) also holds the dots at full so the RAW dotted
      // mark stays visible through full convergence (resolveAmt would dim them).
      const dotsOpacity =
        suppressCrisp || dotsAreMark ? reveal : reveal * (1 - resolveAmt);
      const crispOpacity = dotsAreMark
        ? 1 - reveal // pre-load fallback only; the dots own the formed mark
        : openOnDots
        ? dotsReadyRef.current
          ? resolveAmt
          : fallbackRef.current
            ? 1
            : 0
        : 1 - dotsOpacity;
      if (dotsRef.current) dotsRef.current.style.opacity = String(dotsOpacity);
      if (crispRef.current)
        crispRef.current.style.opacity = String(suppressCrisp ? 0 : crispOpacity);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [showSphere, morph, morphDriveRef, cycleMs, suppressCrisp, openOnDots, dotsAreMark]);

  return (
    <div className={cn("relative", className)} aria-hidden="true">
      {showSphere ? (
        <SphereBoundary>
          <Suspense fallback={null}>
            <div
              ref={dotsRef}
              className={cn(
                "pointer-events-none absolute",
                !morph &&
                  (loop ? "brand-resolve-sphere--loop" : "brand-resolve-sphere"),
                sphereInset,
              )}
              // morph: start hidden; the rAF reveals the dots over the crisp mark
              // once their chunk is ready (smooth in, no blank/pop). sphereMask
              // radially fades the cloud so it never clips at the square canvas
              // edge (the rAF only touches opacity, so the mask persists).
              style={{
                ...(morph ? { opacity: 0 } : null),
                ...(sphereMask
                  ? { WebkitMaskImage: sphereMask, maskImage: sphereMask }
                  : null),
              }}
            >
              <NeuralCoreScene
                {...DEFAULT_SPHERE}
                {...(morph ? DEFAULT_MORPH : null)}
                {...sphereProps}
                {...(morph ? { morph: true, morphDriveRef: drive } : null)}
              />
            </div>
          </Suspense>
        </SphereBoundary>
      ) : null}
      {/* suppressCrisp = the dots ARE the mark; don't render the crisp lockup at
          all (not just opacity 0) so it can never show through. */}
      {!suppressCrisp && (
      <div
        ref={crispRef}
        className="absolute inset-0"
        // Default starts VISIBLE so there's never a blank gap: morph holds the
        // crisp mark until the dots reveal over it (rAF), then crossfades;
        // non-morph / reduced-motion / no-WebGL just keep it full. openOnDots
        // starts HIDDEN: the mark crystallizes in only at the morph peak.
        style={{ opacity: morph && openOnDots ? 0 : 1 }}
      >
        {morph && sphereProps?.lockup && !sphereProps?.lockupMarkOnly ? (
          // LOCKUP: the crisp mark mirrors the dotted lockup - the ring scaled +
          // shifted UP, with the PYRUS wordmark below - so the crossfade lands the
          // crisp logo exactly where the dots settle (no scale/position jump).
          // Percentages tuned against the dotted lockup via the /brandresolve
          // ?splash capture; they track lockupTargets' RING_S / RING_CY / word cy.
          <>
            <div
              className="absolute left-1/2 -translate-x-1/2"
              style={{ width: "62%", aspectRatio: "1", top: "2%" }}
            >
              {logoVariant === "svg" ? (
                <PyrusMark className="h-full w-full" haloBlur={haloBlur} bloomBlur={bloomBlur} />
              ) : (
                <PyrusMark3D className="h-full w-full" haloBlur={haloBlur} bloomBlur={bloomBlur} />
              )}
            </div>
            <img
              src="/brand/pyrus-wordmark-tight.png"
              alt="Pyrus"
              className="absolute left-1/2 -translate-x-1/2"
              style={{ width: "70%", bottom: "9%" }}
            />
          </>
        ) : logoVariant === "svg" ? (
          <PyrusMark className="h-full w-full" haloBlur={haloBlur} bloomBlur={bloomBlur} />
        ) : (
          <PyrusMark3D className="h-full w-full" haloBlur={haloBlur} bloomBlur={bloomBlur} />
        )}
      </div>
      )}
    </div>
  );
}
