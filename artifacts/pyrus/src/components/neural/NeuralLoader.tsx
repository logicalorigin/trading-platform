import { Suspense, lazy, useMemo } from "react";
import BrandLoader, { type BrandLoaderProps } from "../BrandLoader";
import { shouldPlayNeuralOpener } from "@/lib/webglCapability";
import { isNeuralOpenerActive } from "./neuralOpenerState";

const NeuralCanvas = lazy(() => import("./NeuralCanvas"));

export type NeuralLoaderProps = BrandLoaderProps & {
  caption?: string;
};

// Tight neural loader for container / page loading states. Sizes to its parent
// and renders the compact mark-only cloud (forms the mark, then holds + spins).
// Degrades to the crisp BrandLoader when WebGL/motion is unavailable, while the
// WebGL chunk streams, or while the first-load opener already owns a GL context.
export function NeuralLoader({ caption, ...brandProps }: NeuralLoaderProps) {
  const capable = useMemo(() => shouldPlayNeuralOpener(), []);

  if (!capable || isNeuralOpenerActive()) {
    return <BrandLoader {...brandProps} />;
  }

  return (
    <div
      className="neural-loader"
      data-testid="neural-loader"
      role="status"
      aria-label={brandProps.label ?? "Loading PYRUS"}
    >
      <Suspense fallback={<BrandLoader {...brandProps} />}>
        <NeuralCanvas mode="tight" />
      </Suspense>
      {caption ? <div className="neural-loader-caption">{caption}</div> : null}
    </div>
  );
}

export default NeuralLoader;
