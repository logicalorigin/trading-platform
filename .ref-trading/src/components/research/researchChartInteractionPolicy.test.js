import test from "node:test";
import assert from "node:assert/strict";
import {
  isUserRangeSource,
  resolveDeferredPresentationDelayMs,
  shouldDeferVisibleRangeClampUntilIdle,
  shouldDeferRenderWindowRefreshUntilIdle,
  shouldReassertVisibleRangeOnIdle,
  shouldTreatVisibleRangeChangeAsActiveUserInteraction,
} from "./researchChartInteractionPolicy.js";

test("wheel and drag defer render-window refresh until interaction idle", () => {
  assert.equal(shouldDeferRenderWindowRefreshUntilIdle("chart-wheel"), true);
  assert.equal(shouldDeferRenderWindowRefreshUntilIdle("chart-drag"), true);
  assert.equal(shouldDeferRenderWindowRefreshUntilIdle("selection"), false);
});

test("wheel delay resolves from wheel-specific config", () => {
  const delays = {
    defaultDelayMs: 220,
    dragDelayMs: 280,
    wheelDelayMs: 320,
  };

  assert.equal(resolveDeferredPresentationDelayMs("chart-wheel", delays), 320);
  assert.equal(resolveDeferredPresentationDelayMs("chart-drag", delays), 280);
  assert.equal(resolveDeferredPresentationDelayMs("selection", delays), 220);
});

test("resize updates are treated as non-user range changes", () => {
  assert.equal(isUserRangeSource("resize"), false);
  assert.equal(isUserRangeSource("chart-wheel"), true);
});

test("only non-programmatic user-owned wheel or drag changes extend active interaction state", () => {
  assert.equal(shouldTreatVisibleRangeChangeAsActiveUserInteraction({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "chart-drag",
  }), true);
  assert.equal(shouldTreatVisibleRangeChangeAsActiveUserInteraction({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "chart-wheel",
  }), true);
  assert.equal(shouldTreatVisibleRangeChangeAsActiveUserInteraction({
    isProgrammaticUpdate: true,
    interactionOwner: "user",
    interactionSource: "chart-wheel",
  }), false);
  assert.equal(shouldTreatVisibleRangeChangeAsActiveUserInteraction({
    isProgrammaticUpdate: false,
    interactionOwner: "preset",
    interactionSource: "chart-drag",
  }), false);
  assert.equal(shouldTreatVisibleRangeChangeAsActiveUserInteraction({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "resize",
  }), false);
});

test("immediate visible-range clamps are deferred only for active user wheel or drag input", () => {
  assert.equal(shouldDeferVisibleRangeClampUntilIdle({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "chart-wheel",
  }), true);
  assert.equal(shouldDeferVisibleRangeClampUntilIdle({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "chart-drag",
  }), true);
  assert.equal(shouldDeferVisibleRangeClampUntilIdle({
    isProgrammaticUpdate: false,
    interactionOwner: "user",
    interactionSource: "resize",
  }), false);
  assert.equal(shouldDeferVisibleRangeClampUntilIdle({
    isProgrammaticUpdate: true,
    interactionOwner: "user",
    interactionSource: "chart-wheel",
  }), false);
});

test("idle presentation no longer reasserts the visible range after drag or wheel input", () => {
  assert.equal(shouldReassertVisibleRangeOnIdle("chart-drag"), false);
  assert.equal(shouldReassertVisibleRangeOnIdle("chart-wheel"), false);
});
