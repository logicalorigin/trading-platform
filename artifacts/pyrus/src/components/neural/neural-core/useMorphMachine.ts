import { useRef } from "react";
import { TIMING, type NeuralMode, type NeuralState } from "./types";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
const easeIn = (p: number) => p * p;

export type MorphTick = {
  revealed: boolean;
  justDispersing: boolean;
};

// Drives the timeline. NeuralPoints calls `update(dtMs)` every frame and reads
// `morph` / `scatter` / `opacity` into the shader uniforms.
//   - "opener": loop → form lockup → disperse → reveal (fires `revealed` once).
//   - "tight":  loop briefly → form the mark → hold forever (never reveals);
//     NeuralPoints spins the formed mark as the idle loader motion.
export class MorphMachine {
  state: NeuralState = "loading-loop";
  morph = 0;
  scatter = 0;
  opacity = 1;

  private mode: NeuralMode;
  private elapsedInState = 0;
  private totalElapsed = 0;
  private contentReady = false;

  constructor(mode: NeuralMode) {
    this.mode = mode;
  }

  setContentReady(value: boolean) {
    this.contentReady = value;
  }

  private transition(next: NeuralState) {
    this.state = next;
    this.elapsedInState = 0;
  }

  update(dtMs: number): MorphTick {
    this.totalElapsed += dtMs;
    this.elapsedInState += dtMs;
    let revealed = false;
    let justDispersing = false;

    switch (this.state) {
      case "loading-loop": {
        this.morph = 0;
        this.scatter = 0;
        this.opacity = 1;
        if (this.mode === "opener") {
          const ready =
            (this.contentReady && this.totalElapsed >= TIMING.minLoopMs) ||
            this.totalElapsed >= TIMING.maxWaitMs;
          if (ready) this.transition("forming");
        } else if (this.totalElapsed >= TIMING.tightMinLoopMs) {
          this.transition("forming");
        }
        break;
      }
      case "forming": {
        const duration =
          this.mode === "tight" ? TIMING.tightFormMs : TIMING.formingMs;
        const p = clamp01(this.elapsedInState / duration);
        this.morph = easeInOut(p);
        if (p >= 1) {
          this.morph = 1;
          this.transition("formed");
        }
        break;
      }
      case "formed": {
        this.morph = 1;
        // Tight loaders hold the formed mark indefinitely (spun by NeuralPoints).
        if (this.mode === "tight") break;
        if (this.elapsedInState >= TIMING.formedHoldMs) {
          this.transition("dispersing");
          justDispersing = true;
        }
        break;
      }
      case "dispersing": {
        const p = clamp01(this.elapsedInState / TIMING.dispersingMs);
        this.morph = 1;
        this.scatter = easeIn(p);
        this.opacity = 1 - easeInOut(p);
        if (p >= 1) {
          this.opacity = 0;
          this.transition("revealed");
          revealed = true;
        }
        break;
      }
      case "revealed": {
        this.opacity = 0;
        break;
      }
    }

    return { revealed, justDispersing };
  }
}

export function useMorphMachine(mode: NeuralMode): MorphMachine {
  const ref = useRef<MorphMachine | null>(null);
  if (ref.current === null) ref.current = new MorphMachine(mode);
  return ref.current;
}
