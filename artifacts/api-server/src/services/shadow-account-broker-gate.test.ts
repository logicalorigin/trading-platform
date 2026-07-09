import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./shadow-account.ts", import.meta.url), "utf8");

test("manual shadow preview and place do not require live IBKR trading availability", () => {
  const previewStart = source.indexOf("export async function previewShadowOrder");
  const placeStart = source.indexOf("export async function placeShadowOrder");
  const placeEnd = source.indexOf("function isSignalOptionsShadowSource");
  assert.ok(previewStart >= 0, "previewShadowOrder source must exist");
  assert.ok(placeStart > previewStart, "placeShadowOrder source must follow previewShadowOrder");
  assert.ok(placeEnd > placeStart, "placeShadowOrder source boundary must exist");

  const previewSource = source.slice(
    previewStart,
    placeStart,
  );
  const placeSource = source.slice(
    placeStart,
    placeEnd,
  );

  assert.doesNotMatch(previewSource, /assertIbkrGatewayTradingAvailable/);
  assert.doesNotMatch(placeSource, /assertIbkrGatewayTradingAvailable/);
});

test("placeShadowOrder uses the reserved trading database lane", () => {
  const placeStart = source.indexOf("export async function placeShadowOrder");
  const placeEnd = source.indexOf("function isSignalOptionsShadowSource");
  assert.ok(placeStart >= 0, "placeShadowOrder source must exist");
  assert.ok(placeEnd > placeStart, "placeShadowOrder source boundary must exist");

  const placeSource = source.slice(placeStart, placeEnd);

  assert.match(placeSource, /\bdbTrading\.transaction\b/);
  assert.doesNotMatch(placeSource, /\bdb\.transaction\b/);
  assert.doesNotMatch(placeSource, /\bawait db\s*\./);
});
