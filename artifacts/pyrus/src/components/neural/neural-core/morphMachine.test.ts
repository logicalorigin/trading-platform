import assert from "node:assert/strict";
import test from "node:test";
import { MorphMachine } from "./useMorphMachine";
import { TIMING } from "./types";

const FRAME = 16; // ms

// Drive the machine for a given duration, optionally flagging content ready at a
// point in time. Returns how many times it reported `revealed` / `justDispersing`.
function run(
  machine: MorphMachine,
  totalMs: number,
  opts: { readyAtMs?: number } = {},
) {
  let elapsed = 0;
  let revealedCount = 0;
  let disperseCount = 0;
  while (elapsed < totalMs) {
    if (opts.readyAtMs !== undefined && elapsed >= opts.readyAtMs) {
      machine.setContentReady(true);
    }
    const tick = machine.update(FRAME);
    if (tick.revealed) revealedCount++;
    if (tick.justDispersing) disperseCount++;
    elapsed += FRAME;
  }
  return { revealedCount, disperseCount };
}

test("opener stays looping while content is not ready", () => {
  const m = new MorphMachine("opener");
  run(m, TIMING.minLoopMs + 2000); // well past minLoop, but never ready
  assert.equal(m.state, "loading-loop");
  assert.equal(m.morph, 0);
  assert.equal(m.opacity, 1);
});

test("opener will not form before the minimum loop has elapsed", () => {
  const m = new MorphMachine("opener");
  // Ready immediately, but only run for less than minLoopMs.
  run(m, TIMING.minLoopMs - 100, { readyAtMs: 0 });
  assert.equal(m.state, "loading-loop");
});

test("opener forms, disperses and reveals once boot is complete", () => {
  const m = new MorphMachine("opener");
  const total =
    TIMING.minLoopMs +
    TIMING.formingMs +
    TIMING.formedHoldMs +
    TIMING.dispersingMs +
    500;
  const { revealedCount, disperseCount } = run(m, total, { readyAtMs: 0 });
  assert.equal(m.state, "revealed");
  assert.equal(m.opacity, 0);
  assert.equal(m.morph, 1);
  assert.equal(revealedCount, 1, "reveal fires exactly once");
  assert.equal(disperseCount, 1, "disperse-start fires exactly once");
});

test("opener reveals via the max-wait backstop even if never ready", () => {
  const m = new MorphMachine("opener");
  const total =
    TIMING.maxWaitMs +
    TIMING.formingMs +
    TIMING.formedHoldMs +
    TIMING.dispersingMs +
    500;
  const { revealedCount } = run(m, total); // never ready
  assert.equal(m.state, "revealed");
  assert.equal(revealedCount, 1);
});

test("tight mode forms the mark and holds it forever, never revealing", () => {
  const m = new MorphMachine("tight");
  const { revealedCount, disperseCount } = run(m, TIMING.maxWaitMs + 5000);
  assert.equal(m.state, "formed");
  assert.equal(m.morph, 1);
  assert.equal(m.scatter, 0);
  assert.equal(m.opacity, 1);
  assert.equal(revealedCount, 0);
  assert.equal(disperseCount, 0);
});

test("morph monotonically increases through forming", () => {
  const m = new MorphMachine("opener");
  m.setContentReady(true);
  // advance past minLoop into forming
  run(m, TIMING.minLoopMs + 50, { readyAtMs: 0 });
  assert.equal(m.state, "forming");
  let prev = m.morph;
  for (let i = 0; i < 20; i++) {
    m.update(FRAME);
    assert.ok(m.morph >= prev - 1e-6, "morph never decreases while forming");
    prev = m.morph;
  }
});
