import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./shadow-account.ts", import.meta.url),
  "utf8",
);

test("shadow fast positions isolate their cache and skip full-only database enrichment", () => {
  const start = source.indexOf("export async function getShadowAccountPositions");
  const end = source.indexOf("\nexport function getShadowMarketingPositions", start);
  assert.notEqual(start, -1, "Missing shadow positions loader");
  assert.notEqual(end, -1, "Missing shadow positions loader boundary");
  const loader = source.slice(start, end);

  assert.match(loader, /detail\?: "fast" \| "marketing" \| "full"/);
  assert.match(loader, /const fast = input\.detail === "fast"/);
  assert.match(loader, /fast \? ":fast" : ""/);
  assert.match(
    loader,
    /const automationManagementEvents = marketing \|\| fast[\s\S]*?new Map<string, ExecutionEvent>\(\)/,
  );
  assert.match(
    loader,
    /const dayChanges = fast[\s\S]*?new Map<string, ShadowPositionDayChange>\(\)/,
  );
  assert.match(
    loader,
    /const peakMarkByPositionId = marketing \|\| fast[\s\S]*?new Map<string, number>\(\)/,
  );
});

test("shadow fast positions still honor explicit live quote hydration", () => {
  const start = source.indexOf("export async function getShadowAccountPositions");
  const end = source.indexOf("\nexport function getShadowMarketingPositions", start);
  const loader = source.slice(start, end);

  assert.match(loader, /const includeLiveQuotes = input\.liveQuotes !== false/);
  assert.match(loader, /if \(hasOptionPositions && includeLiveQuotes\)/);
  assert.match(loader, /const \[equityQuoteBySymbol, underlyingMarkets\] = includeLiveQuotes/);
  assert.doesNotMatch(loader, /fast\s*&&\s*includeLiveQuotes\s*=\s*false/);
});
