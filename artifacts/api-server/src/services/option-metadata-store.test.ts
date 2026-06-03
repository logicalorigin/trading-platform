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

test("durable option metadata uses scoped transient backoff instead of a runtime kill switch", () => {
  const code = source();

  assert.match(code, /createTransientPostgresBackoff/);
  assert.match(code, /isTransientPostgresError/);
  assert.match(code, /durableOptionMetadataScope/);
  assert.match(code, /durableOptionMetadataBackoffs/);
  assert.match(code, /operation:\s*"load_option_chain"/);
  assert.match(code, /operation:\s*"load_option_expirations"/);
  assert.match(code, /operation:\s*"persist_option_chain"/);
  assert.match(code, /activeBackoffs/);
  assert.doesNotMatch(code, /durableOptionMetadataDisabled\s*=\s*true/);
});
