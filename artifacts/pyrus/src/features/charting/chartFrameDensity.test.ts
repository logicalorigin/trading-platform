import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveResearchChartFrameChromeMetrics,
  resolveResearchChartFramePlacement,
} from "./chartFrameDensity.tsx";

test("compact density preserves intentionally smaller placement chrome", () => {
  const placement = resolveResearchChartFramePlacement("market-compact-active");

  assert.deepEqual(resolveResearchChartFrameChromeMetrics(placement, "compact"), {
    compact: true,
    surfaceTopOverlayHeight: 24,
    surfaceLeftOverlayWidth: 24,
    surfaceBottomOverlayHeight: 14,
  });
});

test("compact density still caps larger workspace chrome", () => {
  const placement = resolveResearchChartFramePlacement("workspace");

  assert.deepEqual(resolveResearchChartFrameChromeMetrics(placement, "compact"), {
    compact: true,
    surfaceTopOverlayHeight: 28,
    surfaceLeftOverlayWidth: 30,
    surfaceBottomOverlayHeight: 16,
  });
});
