import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(new URL("./platform.ts", import.meta.url), "utf8");
const bridgeStreamsSource = readFileSync(
  new URL("./bridge-streams.ts", import.meta.url),
  "utf8",
);

test("public option-chain metadata policy avoids self-imposed waits", () => {
  assert.match(
    platformSource,
    /export const OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS = readPositiveIntegerEnv\(/,
  );
  assert.match(
    platformSource,
    /emptyRetryDelaysMs\?: readonly number\[\];/,
  );
  assert.match(
    platformSource,
    /input\.emptyRetryDelaysMs \?\? OPTION_CHAIN_EMPTY_RETRY_DELAYS_MS/,
  );
  assert.match(
    platformSource,
    /Math\.max\(1, getOptionsFlowRuntimeConfig\(\)\.optionChainBatchConcurrency\)/,
  );
  assert.doesNotMatch(
    platformSource,
    /Math\.min\(1, getOptionsFlowRuntimeConfig\(\)\.optionChainBatchConcurrency\)/,
  );
});

test("option-chain streams fetch metadata rows without delayed quote hydration", () => {
  assert.match(bridgeStreamsSource, /quoteHydration: "metadata"/);
  assert.match(bridgeStreamsSource, /allowDelayedSnapshotHydration: false/);
  assert.match(bridgeStreamsSource, /timeoutMs: OPTION_CHAIN_PUBLIC_METADATA_TIMEOUT_MS/);
  assert.match(bridgeStreamsSource, /emptyRetryDelaysMs: \[\]/);
});
