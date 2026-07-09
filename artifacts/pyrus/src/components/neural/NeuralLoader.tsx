import BrandLoader, { type BrandLoaderProps } from "../BrandLoader";
import { BootShellLayout, LOADER_CLOUD_PROPS } from "./BootShellLayout";
import { isNeuralOpenerActive } from "./neuralOpenerState";

export { LOADER_CLOUD_PROPS };

export type NeuralLoaderProps = BrandLoaderProps & {
  caption?: string;
};

// The app/container loading state. While the first-load opener owns a WebGL
// context we degrade to the static BrandLoader (it stays hidden beneath the
// opener); otherwise we render the shared immersive BootShellLayout so the
// loading screen matches the boot curtain and the sign-in screen exactly —
// full-page neural cloud, brand on the left, calm loading affordance beneath it.
export function NeuralLoader({
  caption: _caption,
  label = "PYRUS",
  minHeight = "100vh",
  progress = null,
  testId = "neural-loader",
  tone = "app",
  ...brandProps
}: NeuralLoaderProps) {
  void _caption;
  if (isNeuralOpenerActive()) {
    return (
      <BrandLoader
        {...brandProps}
        label={label}
        minHeight={minHeight}
        progress={progress}
        testId={testId}
        tone={tone}
      />
    );
  }

  return <BootShellLayout testId={testId} label={label} />;
}

export default NeuralLoader;
