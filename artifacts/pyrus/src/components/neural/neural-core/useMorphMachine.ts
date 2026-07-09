import { TIMING, type NeuralState } from "./types";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (p: number) =>
  p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
const easeIn = (p: number) => p * p;

export type MorphTick = {
  revealed: boolean;
  justDispersing: boolean;
};

// Drives the timeline. NeuralCanvas calls `update(dtMs)` every frame and reads
// `morph` / `scatter` into the shader uniforms.
// Loop → form lockup → disperse → reveal (fires `revealed` once).
export class MorphMachine {
  state: NeuralState = "loading-loop";
  morph = 0;
  scatter = 0;

  private elapsedInState = 0;
  private totalElapsed = 0;
  private contentReady = false;

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
        const ready =
          (this.contentReady && this.totalElapsed >= TIMING.minLoopMs) ||
          this.totalElapsed >= TIMING.maxWaitMs;
        if (ready) this.transition("forming");
        break;
      }
      case "forming": {
        const p = clamp01(this.elapsedInState / TIMING.formingMs);
        this.morph = easeInOut(p);
        if (p >= 1) {
          this.morph = 1;
          this.transition("formed");
        }
        break;
      }
      case "formed": {
        this.morph = 1;
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
        if (p >= 1) {
          this.transition("revealed");
          revealed = true;
        }
        break;
      }
      case "revealed":
        break;
    }

    return { revealed, justDispersing };
  }
}
