import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const optionMetadataSource = readFileSync(
  new URL("./option-metadata-store.ts", import.meta.url),
  "utf8",
);
const workerIngestSource = readFileSync(
  new URL("../../../../crates/market-data-worker/src/ingest.rs", import.meta.url),
  "utf8",
);
const gexSource = readFileSync(
  new URL("../../../../crates/market-data-worker/src/compute/gex.rs", import.meta.url),
  "utf8",
);

test("API durable option metadata writes and reads option_chain_latest only", () => {
  assert.match(optionMetadataSource, /optionChainLatestTable/);
  assert.match(optionMetadataSource, /\.insert\(optionChainLatestTable\)/);
  assert.match(optionMetadataSource, /\.from\(optionChainLatestTable\)/);
  assert.match(optionMetadataSource, /onConflictDoUpdate/);
  assert.match(optionMetadataSource, /excluded\.as_of >=/);
  assert.doesNotMatch(optionMetadataSource, /optionChainSnapshotsTable/);
});

test("Rust worker option-chain persistence no longer appends snapshots", () => {
  assert.match(workerIngestSource, /upsert_option_chain_latest_tx/);
  assert.match(workerIngestSource, /insert into option_chain_latest/);
  assert.match(workerIngestSource, /on conflict \(option_contract_id, source\) do update/);
  assert.doesNotMatch(workerIngestSource, /insert into option_chain_snapshots/);
});

test("GEX hydration reads Massive rows from option_chain_latest", () => {
  assert.match(gexSource, /from option_chain_latest snap/);
  assert.match(gexSource, /snap\.source = 'massive'/);
  assert.doesNotMatch(gexSource, /from option_chain_snapshots/);
});
