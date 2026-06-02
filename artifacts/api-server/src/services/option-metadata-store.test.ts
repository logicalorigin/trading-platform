import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = () =>
  readFileSync(new URL("./option-metadata-store.ts", import.meta.url), "utf8");

test("durable option metadata pruning does not delete market-data worker snapshots", () => {
  const code = source();

  assert.match(code, /OPTION_METADATA_PRUNABLE_SOURCES/);
  assert.match(code, /"ibkr-metadata"/);
  assert.match(code, /"ibkr-snapshot"/);
  assert.match(code, /OPTION_METADATA_PRUNABLE_SIGNAL_OPTIONS_PREFIX/);
  assert.match(
    code,
    /and\(\s*lt\(optionChainSnapshotsTable\.asOf,\s*cutoff\),\s*prunableSourceFilter\s*\)/s,
  );
  assert.doesNotMatch(
    code,
    /\.where\(\s*lt\(optionChainSnapshotsTable\.asOf,\s*cutoff\)\s*\)/s,
  );
});
