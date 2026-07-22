import BrandLoader, { type BrandLoaderProps } from "../BrandLoader";
import {
  BootShellLayout,
  LOADER_CLOUD_PROPS,
} from "./BootShellLayout";
import { isNeuralOpenerActive } from "./neuralOpenerState";

export { LOADER_CLOUD_PROPS };

export type NeuralLoaderProps = BrandLoaderProps & {
  caption?: string;
  variant?: "immersive" | "workspace";
};

// The shared launch/auth and in-workspace loading state. While the first-load
// opener owns a WebGL context, immersive loaders degrade to the static
// BrandLoader; workspace loaders retain their compact static cloud without
// competing for a second WebGL context.
export function NeuralLoader({
  caption: _caption,
  label = "PYRUS",
  minHeight = "100vh",
  progress = null,
  testId = "neural-loader",
  tone = "app",
  variant = "immersive",
  ...brandProps
}: NeuralLoaderProps) {
  const openerActive = isNeuralOpenerActive();
  if (openerActive && variant === "immersive") {
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

  return (
    <BootShellLayout
      testId={testId}
      label={_caption || label}
      minHeight={minHeight}
      progress={progress}
      variant={variant}
      cloudSuppressed={openerActive}
    />
  );
}

export default NeuralLoader;
