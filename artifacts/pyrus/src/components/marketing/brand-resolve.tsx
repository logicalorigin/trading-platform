/**
 * BrandResolve - the looping particle-to-mark treatment shared by the app header
 * and loader surfaces. Reduced-motion or unavailable-WebGL clients keep the SVG.
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

import { PyrusMark } from "@/components/marketing/pyrus-mark";
import { usePrefersReducedMotion } from "@/components/marketing/use-prefers-reduced-motion";
import type { NeuralCoreProps } from "@/components/marketing/neural-core";
import { isWebglAvailable } from "@/lib/webglCapability";
import { cn } from "@/lib/utils";

const NeuralCoreScene = lazy(
  () => import("@/components/marketing/neural-core-scene"),
);

const DEFAULT_SPHERE = {
  look: "balanced",
  particles: 14000,
  orbitCount: 5400,
  radius: 2,
  particleSize: 0.19,
  coreOpacity: 0.42,
  orbitOpacity: 0.28,
  distortion: 0.62,
  rotationSpeed: 0.18,
  morphCycleMs: 9000,
  ringScale: 0.8,
} satisfies Partial<NeuralCoreProps>;

class SphereBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function BrandResolve({
  className,
  haloBlur,
  bloomBlur,
  sphereProps,
  sphereInsetClassName,
}: {
  className?: string;
  haloBlur?: number;
  bloomBlur?: number;
  sphereProps?: Partial<NeuralCoreProps>;
  sphereInsetClassName?: string;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [sphereFailed, setSphereFailed] = useState(false);
  const dotsRef = useRef<HTMLDivElement>(null);
  const crispRef = useRef<HTMLDivElement>(null);
  const drive = useRef({ morph: 0, scatter: 0 });
  const dotsReadyRef = useRef(false);

  useEffect(() => setMounted(true), []);

  // Context creation is synchronous, so leave it out of the first render.
  const showSphere =
    mounted && !sphereFailed && !reducedMotion && isWebglAvailable();
  const cycleMs =
    sphereProps?.morphCycleMs ?? DEFAULT_SPHERE.morphCycleMs;
  const sphereInset = sphereInsetClassName ?? "-inset-[45%]";

  useEffect(() => {
    if (!showSphere) return;

    dotsReadyRef.current = false;
    let alive = true;
    const markReady = () => {
      if (alive) dotsReadyRef.current = true;
    };
    const markFailed = () => {
      if (alive) setSphereFailed(true);
    };
    import("@/components/marketing/neural-core-scene").then(
      markReady,
      markFailed,
    );

    const start = performance.now();
    let raf = 0;
    let revealStart: number | null = null;
    let lastDotsOpacity = -1;
    let lastCrispOpacity = -1;
    const ease = (x: number) => x * x * (3 - 2 * x);
    const tick = (now: number) => {
      const tt = ((now - start) % cycleMs) / cycleMs;
      let morph: number;
      if (tt < 0.3) morph = 0;
      else if (tt < 0.45) morph = ease((tt - 0.3) / 0.15);
      else if (tt < 0.72) morph = 1;
      else if (tt < 0.88) morph = 1 - ease((tt - 0.72) / 0.16);
      else morph = 0;

      let scatter = 0;
      if (import.meta.env.DEV) {
        const forcedMorph = (
          window as unknown as { __morphForce?: number }
        ).__morphForce;
        if (typeof forcedMorph === "number") {
          morph = forcedMorph;
          scatter =
            (
              window as unknown as { __scatterForce?: number }
            ).__scatterForce ?? 0;
        }
      }
      drive.current.morph = morph;
      drive.current.scatter = scatter;

      if (dotsReadyRef.current && revealStart === null) revealStart = now;
      const reveal =
        revealStart === null
          ? 0
          : ease(Math.min((now - revealStart) / 280, 1));
      const peak = Math.max(0, Math.min(1, (morph - 0.8) / 0.18));
      const resolve =
        ease(peak) * (1 - Math.max(0, Math.min(1, scatter)));
      const dotsOpacity = reveal * (1 - resolve);
      const crispOpacity = 1 - dotsOpacity;

      if (dotsOpacity !== lastDotsOpacity && dotsRef.current) {
        dotsRef.current.style.opacity = String(dotsOpacity);
        lastDotsOpacity = dotsOpacity;
      }
      if (crispOpacity !== lastCrispOpacity && crispRef.current) {
        crispRef.current.style.opacity = String(crispOpacity);
        lastCrispOpacity = crispOpacity;
      }
      raf = requestAnimationFrame(tick);
    };

    tick(start);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [showSphere, cycleMs]);

  return (
    <div className={cn("relative", className)} aria-hidden="true">
      {showSphere ? (
        <SphereBoundary onError={() => setSphereFailed(true)}>
          <Suspense fallback={null}>
            <div
              ref={dotsRef}
              className={cn(
                "pointer-events-none absolute",
                sphereInset,
              )}
              style={{ opacity: 0 }}
            >
              <NeuralCoreScene
                {...DEFAULT_SPHERE}
                {...sphereProps}
                morph
                morphDriveRef={drive}
              />
            </div>
          </Suspense>
        </SphereBoundary>
      ) : null}
      <div ref={crispRef} className="absolute inset-0">
        <PyrusMark
          className="h-full w-full"
          haloBlur={haloBlur}
          bloomBlur={bloomBlur}
        />
      </div>
    </div>
  );
}
