import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { NeuralPoints } from "./neural-core/NeuralPoints";
import type { NeuralMode } from "./neural-core/types";

export type NeuralCanvasProps = {
  mode: NeuralMode;
  contentReady?: boolean;
  onReveal?: () => void;
  onDisperseStart?: () => void;
};

// The single React.lazy boundary for the neural engine — importing this is what
// pulls `three` + `@react-three/fiber` (the `vendor-three` / `neural` chunks) so
// they never touch first paint. Default export for `React.lazy`.
export default function NeuralCanvas({
  mode,
  contentReady = false,
  onReveal,
  onDisperseStart,
}: NeuralCanvasProps) {
  // Pause the rAF loop while the tab is hidden.
  const [frameloop, setFrameloop] = useState<"always" | "never">("always");
  useEffect(() => {
    const sync = () => setFrameloop(document.hidden ? "never" : "always");
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <Canvas
      frameloop={frameloop}
      dpr={[1, 1.5]}
      gl={{ antialias: false, alpha: true, powerPreference: "high-performance" }}
      camera={{ position: [0, 0, 3.2], fov: 50 }}
      style={{ width: "100%", height: "100%" }}
    >
      <NeuralPoints
        mode={mode}
        contentReady={contentReady}
        onReveal={onReveal}
        onDisperseStart={onDisperseStart}
      />
    </Canvas>
  );
}
