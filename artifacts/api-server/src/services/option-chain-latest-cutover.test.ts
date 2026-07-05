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
const workerRetentionSource = readFileSync(
  new URL("../../../../crates/market-data-worker/src/retention.rs", import.meta.url),
  "utf8",
);
const gexSource = readFileSync(
  new URL("../../../../crates/market-data-worker/src/compute/gex.rs", import.meta.url),
  "utf8",
);
const diagnosticsSource = readFileSync(new URL("./diagnostics.ts", import.meta.url), "utf8");
const marketDataSchemaSource = readFileSync(
  new URL("../../../../lib/db/src/schema/market-data.ts", import.meta.url),
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
  assert.match(workerIngestSource, /DEFAULT_OPTION_CHAIN_WRITE_BATCH_SIZE:\s*usize\s*=\s*128/);
  assert.match(workerIngestSource, /on conflict \(symbol\) do nothing/);
  assert.match(workerIngestSource, /on conflict \(massive_ticker\) do nothing/);
  assert.match(workerIngestSource, /is distinct from/);
  assert.doesNotMatch(workerIngestSource, /deactivate_stale_option_contracts/);
  assert.doesNotMatch(workerIngestSource, /insert into option_chain_snapshots/);
});

test("GEX hydration reads Massive rows from option_chain_latest", () => {
  assert.match(gexSource, /latest_chain as/);
  assert.match(gexSource, /max\(snap\.as_of\)/);
  assert.match(gexSource, /join option_chain_latest snap/);
  assert.match(gexSource, /snap\.source = 'massive'/);
  assert.match(gexSource, /contract\.is_active = true/);
  assert.match(gexSource, /contract\.expiration_date >= current_date/);
  assert.match(gexSource, /snap\.as_of >= latest_chain\.as_of - interval '5 seconds'/);
  assert.doesNotMatch(gexSource, /from option_chain_snapshots/);
});

test("legacy option_chain_snapshots table is not retained, monitored, or modeled", () => {
  assert.doesNotMatch(workerRetentionSource, /option_chain_snapshots/);
  assert.doesNotMatch(diagnosticsSource, /option_chain_snapshots/);
  assert.doesNotMatch(marketDataSchemaSource, /optionChainSnapshotsTable/);
  assert.doesNotMatch(marketDataSchemaSource, /pgTable\(\s*["']option_chain_snapshots["']/);
});
