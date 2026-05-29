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

test("zero-gamma overlay resolves from compact API payloads", () => {
  const overlay = resolveGexZeroGammaOverlay(
    {
      ticker: "SPY",
      spot: 100,
      zeroGamma: 104.25,
      asOf: "2026-05-13T15:30:00.000Z",
      isStale: false,
      source: {
        provider: "ibkr",
        status: "ok",
        optionCount: 10,
        usableOptionCount: 10,
        message: null,
      },
    },
    Date.parse("2026-05-13T15:31:00.000Z"),
  );

  assert.equal(overlay.price, 104.25);
  assert.equal(overlay.asOf, "2026-05-13T15:30:00.000Z");
  assert.equal(overlay.isStale, false);
});

test("zero-gamma overlay preserves compact empty values", () => {
  const overlay = resolveGexZeroGammaOverlay(
    {
      ticker: "SPY",
      spot: 100,
      zeroGamma: null,
      asOf: "2026-05-13T15:30:00.000Z",
      isStale: true,
    },
    Date.parse("2026-05-13T15:31:00.000Z"),
  );

  assert.equal(overlay.price, null);
  assert.equal(overlay.isStale, true);
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
  assert.equal(line?.color, "#24C8DB");
});

test("stale zero-gamma line blends toward the chart surface", () => {
  assert.equal(blendGexOverlayColor("#24C8DB", "#090D18", 0.5), "#176b7a");
});

test("GEX zero-gamma hook uses the compact overlay endpoint", () => {
  const source = readFileSync(new URL("./useGexZeroGamma.js", import.meta.url), "utf8");

  assert.match(source, /queryKey:\s*\["gex-zero-gamma",\s*normalizedTicker\]/);
  assert.match(
    source,
    /\/api\/gex\/\$\{encodeURIComponent\(normalizedTicker\)\}\/zero-gamma/,
  );
  assert.match(source, /staleTime:\s*GEX_ZERO_GAMMA_QUERY_STALE_MS/);
  assert.match(source, /refetchInterval:\s*enabled \? GEX_ZERO_GAMMA_QUERY_REFETCH_MS : false/);
  assert.match(source, /placeholderData:\s*\(previousData\) => previousData/);
});

test("GEX reference line refreshes when theme token attributes change", () => {
  const source = readFileSync(new URL("./useGexZeroGamma.js", import.meta.url), "utf8");

  assert.match(source, /new MutationObserver\(notifyGexTokenListeners\)/);
  assert.match(source, /attributeFilter:\s*THEME_ATTRIBUTE_FILTER/);
  assert.match(source, /useSyncExternalStore\(/);
  assert.match(source, /buildGexZeroGammaReferenceLine\(overlay\)/);
});
