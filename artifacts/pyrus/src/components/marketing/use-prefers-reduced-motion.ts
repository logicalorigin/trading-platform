import { useEffect, useState } from "react";

import { prefersReducedMotion } from "@/lib/webglCapability";

const APP_PREFERENCE_ATTRIBUTE = "data-pyrus-reduced-motion";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    const update = () => setReduced(prefersReducedMotion());
    const media =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const observer =
      typeof MutationObserver === "function"
        ? new MutationObserver(update)
        : null;

    update();
    media?.addEventListener("change", update);
    observer?.observe(document.documentElement, {
      attributeFilter: [APP_PREFERENCE_ATTRIBUTE],
      attributes: true,
    });

    return () => {
      media?.removeEventListener("change", update);
      observer?.disconnect();
    };
  }, []);

  return reduced;
}
