import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  GEX_ZERO_GAMMA_LABEL,
  blendGexOverlayColor,
  buildGexZeroGammaReferenceLine,
  resolveGexZeroGammaOverlay,
} from "./useGexZeroGamma.js";

const option = (
  strike: number,
  cp: "C" | "P",
  gamma: number,
  openInterest: number,
) => ({
  strike,
  cp,
  gamma,
  delta: 0.5,
  openInterest,
  impliedVol: 0.3,
  bid: 1,
  ask: 1.1,
  expireYear: 2026,
  expireMonth: 6,
  expireDay: 19,
});

test("zero-gamma overlay resolves from the same GEX dashboard payload", () => {
  const overlay = resolveGexZeroGammaOverlay(
    {
      spot: 100,
      timestamp: "2026-05-13T15:30:00.000Z",
      isStale: false,
      options: [
        option(90, "P", 1, 2),
        option(100, "C", 1, 1),
        option(110, "C", 1, 2),
      ],
    },
    Date.parse("2026-05-13T15:31:00.000Z"),
  );

  assert.equal(overlay.asOf, "2026-05-13T15:30:00.000Z");
  assert.equal(overlay.isStale, false);
  assert.ok(overlay.price != null && overlay.price > 100 && overlay.price < 110);
});

test("zero-gamma overlay treats old dashboard timestamps as stale", () => {
  const overlay = resolveGexZeroGammaOverlay(
    {
      spot: 100,
      timestamp: "2026-05-13T15:00:00.000Z",
      isStale: false,
      options: [
        option(90, "P", 1, 2),
        option(100, "C", 1, 1),
        option(110, "C", 1, 2),
      ],
    },
    Date.parse("2026-05-13T15:20:01.000Z"),
  );

  assert.equal(overlay.isStale, true);
});

test("zero-gamma reference line uses a right-axis chart label", () => {
  const line = buildGexZeroGammaReferenceLine({
    price: 105.25,
    asOf: "2026-05-13T15:30:00.000Z",
    isStale: false,
  });

  assert.equal(line?.price, 105.25);
  assert.equal(line?.title, GEX_ZERO_GAMMA_LABEL);
  assert.equal(line?.axisLabelVisible, true);
  assert.equal(line?.lineWidth, 1);
  assert.equal(line?.color, "#6FB5C2");
});

test("stale zero-gamma line blends toward the chart surface", () => {
  assert.equal(blendGexOverlayColor("#6FB5C2", "#1E1D22", 0.5), "#476972");
});

test("GEX zero-gamma hook shares the GEX screen query cache key", () => {
  const source = readFileSync(new URL("./useGexZeroGamma.js", import.meta.url), "utf8");

  assert.match(source, /queryKey:\s*\["gex-dashboard",\s*normalizedTicker\]/);
  assert.match(
    source,
    /getGexDashboardRequest\(encodeURIComponent\(normalizedTicker\),\s*\{ signal \}\)/,
  );
  assert.match(source, /staleTime:\s*GEX_DASHBOARD_QUERY_STALE_MS/);
  assert.match(source, /refetchInterval:\s*enabled \? GEX_DASHBOARD_QUERY_REFETCH_MS : false/);
});

test("GEX reference line refreshes when theme token attributes change", () => {
  const source = readFileSync(new URL("./useGexZeroGamma.js", import.meta.url), "utf8");

  assert.match(source, /new MutationObserver\(notifyGexTokenListeners\)/);
  assert.match(source, /attributeFilter:\s*THEME_ATTRIBUTE_FILTER/);
  assert.match(source, /useSyncExternalStore\(/);
  assert.match(source, /buildGexZeroGammaReferenceLine\(overlay\)/);
});
