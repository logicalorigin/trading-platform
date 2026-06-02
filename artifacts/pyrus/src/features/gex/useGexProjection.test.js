import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildGexProjectionConeOverlay } from "./useGexProjection.js";

test("buildGexProjectionConeOverlay normalizes usable projection points", () => {
  const overlay = buildGexProjectionConeOverlay({
    ticker: "spy",
    spot: 100,
    asOf: "2026-05-31T15:30:00.000Z",
    quality: { status: "ok" },
    overlayPoints: [
      {
        expirationDate: "2026-06-19",
        lower2: 88,
        lower1: 94,
        center: 101,
        upper1: 108,
        upper2: 114,
        qualityStatus: "ok",
      },
    ],
  });

  assert.equal(overlay?.ticker, "SPY");
  assert.equal(overlay?.spot, 100);
  assert.equal(overlay?.qualityStatus, "ok");
  assert.deepEqual(overlay?.points[0], {
    expirationDate: "2026-06-19",
    lower2: 88,
    lower1: 94,
    center: 101,
    upper1: 108,
    upper2: 114,
    qualityStatus: "ok",
  });
});

test("GEX projection hook uses the compact projection endpoint", () => {
  const source = readFileSync(new URL("./useGexProjection.js", import.meta.url), "utf8");

  assert.match(source, /queryKey:\s*\["gex-projection",\s*normalizedTicker\]/);
  assert.match(
    source,
    /\/api\/gex\/\$\{encodeURIComponent\(normalizedTicker\)\}\/projection\?view=chart/,
  );
  assert.match(source, /staleTime:\s*GEX_PROJECTION_QUERY_STALE_MS/);
  assert.match(source, /placeholderData:\s*\(previousData\) => previousData/);
});
