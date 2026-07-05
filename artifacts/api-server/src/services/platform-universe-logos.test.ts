import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");

function functionSource(name: string): string {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `Missing ${name}`);
  const nextFunction = source.indexOf("\nfunction ", start + 1);
  const nextExportedFunction = source.indexOf("\nexport ", start + 1);
  const candidates = [nextFunction, nextExportedFunction].filter(
    (index) => index !== -1,
  );
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

test("universe logo provider hydration is bounded", () => {
  const fetchLogoRecord = functionSource("fetchUniverseLogoRecord");
  const getLogosStart = source.indexOf("export async function getUniverseLogos");
  assert.notEqual(getLogosStart, -1, "Missing getUniverseLogos");
  const getLogos = source.slice(
    getLogosStart,
    source.indexOf("\nfunction ", getLogosStart + 1),
  );

  assert.match(source, /const UNIVERSE_LOGO_PROVIDER_CONCURRENCY = 4;/);
  assert.match(source, /const UNIVERSE_LOGO_PROVIDER_TIMEOUT_MS = 750;/);
  assert.match(fetchLogoRecord, /createAbortBudgetSignal\(/);
  assert.match(fetchLogoRecord, /UNIVERSE_LOGO_PROVIDER_TIMEOUT_MS/);
  assert.match(fetchLogoRecord, /remainingProviderBudgetMs\(\)/);
  assert.match(getLogos, /mapWithConcurrency\(/);
  assert.match(getLogos, /UNIVERSE_LOGO_PROVIDER_CONCURRENCY/);
});

