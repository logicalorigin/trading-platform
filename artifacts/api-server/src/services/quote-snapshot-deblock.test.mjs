import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// getQuoteSnapshotsUncached is private and deeply coupled to the Massive runtime,
// the realtime socket store, and admission control, so we guard the de-blocking
// invariant at the source level (same convention as live-streams.test.mjs). The
// freeze regression was: the Massive-realtime snapshot path awaited a day-change
// context refresh for ALL requested symbols, pinning the request (and a scarce
// DB-pool slot) on a multi-second upstream REST call and cascading into API
// saturation / frozen prices. These assertions fail if that blocking pattern
// comes back.
const source = readFileSync(
  new URL("./platform.ts", import.meta.url),
  "utf8",
);

test("snapshot path no longer block-refreshes day-change context for all symbols", () => {
  assert.doesNotMatch(
    source,
    /const contextQuotes = await refreshMassiveQuoteDayChangeContext\(symbols\);/,
  );
});

test("snapshot path warms stale live-symbol context in the background (fire-and-forget)", () => {
  assert.match(
    source,
    /seedStockQuoteDayChangeContext\(symbols\);/,
  );
});

test("snapshot path does not mask missing Massive realtime quotes with historical fallbacks", () => {
  assert.doesNotMatch(source, /loadStoredBarQuoteSnapshots/);
  assert.doesNotMatch(source, /QUOTE_SNAPSHOT_STORED_BAR_FALLBACK_SOURCE/);
  assert.doesNotMatch(source, /const missingSymbols = symbols\.filter/);
  const realtimeBranch = source.match(
    /if \(useMassiveRealtimePrimary\) \{[\s\S]*?return \{\s*quotes,[\s\S]*?fallbackUsed: false,\s*\};\s*\}/,
  )?.[0] ?? "";
  assert.ok(realtimeBranch, "Massive realtime quote snapshot branch is missing");
  assert.doesNotMatch(
    realtimeBranch,
    /fetchMassiveRestStockQuoteSnapshots|getMassiveClient\(\)\.getQuoteSnapshots/,
  );
});
