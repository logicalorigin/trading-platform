import assert from "node:assert/strict";
import test from "node:test";
import {
  fibonacciSphere,
  mulberry32,
  sampleLogoTargets,
} from "./neural-geometry";

test("mulberry32 is deterministic for a given seed", () => {
  const a = mulberry32(123);
  const b = mulberry32(123);
  const seqA = [a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test("fibonacciSphere returns count*3 finite points on the unit sphere", () => {
  const count = 500;
  const pts = fibonacciSphere(count, 1);
  assert.equal(pts.length, count * 3);
  for (let i = 0; i < count; i++) {
    const x = pts[i * 3];
    const y = pts[i * 3 + 1];
    const z = pts[i * 3 + 2];
    assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
    const r = Math.hypot(x, y, z);
    assert.ok(Math.abs(r - 1) < 0.05, `radius ${r} ~ 1`);
  }
});

test("sampleLogoTargets falls back to a finite sphere without a DOM", async () => {
  // Runs under node (no document) → exercises the canvas-unavailable fallback.
  const count = 800;
  const pts = await sampleLogoTargets({ count, seed: 7 });
  assert.equal(pts.length, count * 3);
  for (let i = 0; i < pts.length; i++) assert.ok(Number.isFinite(pts[i]));
});
