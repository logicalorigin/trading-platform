import NeuralCore, {
  type NeuralCoreProps,
} from "@/components/marketing/neural-core";

export type NeuralCanvasProps = {
  cloudProps: Partial<NeuralCoreProps>;
  mask: string;
};

// The opener is the same pure cloud used by the shared loading/auth shell.
export default function NeuralCanvas({
  cloudProps,
  mask,
}: NeuralCanvasProps) {
  return (
    <NeuralCore
      {...cloudProps}
      className="h-full w-full"
      style={{
        height: "100%",
        width: "100%",
        maskImage: mask,
        WebkitMaskImage: mask,
      }}
    />
  );
}
