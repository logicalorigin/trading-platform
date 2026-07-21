import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const platformAppSource = readSource("./PlatformApp.jsx");
const portfolioPulseSource = readSource("./PortfolioPulseZone.jsx");

test("lightweight platform position consumers use the canonical fast endpoint", () => {
  assert.doesNotMatch(platformAppSource, /\buseListPositions\b/);
  assert.match(
    platformAppSource,
    /const positionAlertsQuery = useGetAccountPositions\(\s*primaryAccountId \|\| "",\s*\{\s*mode: environment,\s*detail: "fast",\s*liveQuotes: false,?\s*\}/,
  );

  assert.doesNotMatch(portfolioPulseSource, /\buseListPositions\b/);
  assert.match(
    portfolioPulseSource,
    /const positionsQuery = useGetAccountPositions\(\s*accountId \|\| "",\s*\{\s*mode,\s*detail: "fast",\s*liveQuotes: false,?\s*\}/,
  );
});
