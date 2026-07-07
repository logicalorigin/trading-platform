import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  isNeuralWebglRendererSupported,
  prefersReducedMotion,
  shouldPlayNeuralOpener,
} from "@/lib/webglCapability";
import { PyrusMark } from "./pyrus-mark";

const PyrusMark3DScene = lazy(() => import("./pyrus-mark-3d-scene"));

export type PyrusMark3DProps = {
  className?: string;
  haloBlur?: number;
  bloomBlur?: number;
  title?: string;
};

export function canUseWebGL(): boolean {
  return isNeuralWebglRendererSupported();
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    update();

    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return undefined;
    }

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function PyrusMark3D({
  bloomBlur,
  className,
  haloBlur,
  title = "Pyrus",
}: PyrusMark3DProps) {
  const capable = useMemo(() => shouldPlayNeuralOpener(), []);
  const fallback = (
    <PyrusMark
      bloomBlur={bloomBlur}
      className={className}
      haloBlur={haloBlur}
      title={title}
    />
  );

  if (!capable) {
    return fallback;
  }

  return (
    <span
      aria-label={title || undefined}
      className={cn("pyrus-mark-3d", className)}
      role={title ? "img" : undefined}
    >
      <Suspense
        fallback={
          <PyrusMark
            bloomBlur={bloomBlur}
            className="pyrus-mark-3d-fallback"
            haloBlur={haloBlur}
            title=""
          />
        }
      >
        <PyrusMark3DScene />
      </Suspense>
    </span>
  );
}

export default PyrusMark3D;
