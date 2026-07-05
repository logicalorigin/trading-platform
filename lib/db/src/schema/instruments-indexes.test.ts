import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schemaSource = readFileSync(
  new URL("./instruments.ts", import.meta.url),
  "utf8",
);
const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260626_option_contracts_active_chain_order_idx.sql",
    import.meta.url,
  ),
  "utf8",
);

test("active option-chain order index migration quotes the right column", () => {
  assert.match(schemaSource, /option_contracts_active_chain_order_idx/);
  assert.match(
    migrationSource,
    /CREATE INDEX CONCURRENTLY IF NOT EXISTS option_contracts_active_chain_order_idx/i,
  );
  assert.match(
    migrationSource,
    /ON option_contracts \(underlying_instrument_id, expiration_date, strike, "right"\)/i,
  );
  assert.doesNotMatch(
    migrationSource,
    /ON option_contracts \(underlying_instrument_id, expiration_date, strike, right\)/i,
  );
});
