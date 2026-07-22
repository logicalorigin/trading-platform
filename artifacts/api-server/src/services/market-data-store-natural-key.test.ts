import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync(
  new URL("./market-data-store.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(
  new URL("../../../../lib/db/src/schema/market-data.ts", import.meta.url),
  "utf8",
);

test("the shared bar-cache upsert uses the verified symbol natural key", () => {
  const barCacheSchema = schemaSource.slice(
    schemaSource.indexOf("export const barCacheTable"),
    schemaSource.indexOf("export const optionChainLatestTable"),
  );
  assert.match(
    barCacheSchema,
    /uniqueIndex\("bar_cache_symbol_timeframe_source_starts_at_key"\)[\s\S]*table\.symbol,[\s\S]*table\.timeframe,[\s\S]*table\.source,[\s\S]*table\.startsAt/,
  );
  assert.equal(
    storeSource.match(
      /on conflict \(symbol, timeframe, source, starts_at\) do update/gi,
    )?.length,
    1,
  );
  assert.equal(
    storeSource.match(/upsertBarCacheRows\((?:values|batch), now\)/g)?.length,
    3,
  );
  assert.doesNotMatch(
    storeSource,
    /target:\s*\[\s*barCacheTable\.instrumentId,/,
  );
  assert.doesNotMatch(barCacheSchema, /id:\s*uuid\("id"\)/);
  assert.doesNotMatch(
    barCacheSchema,
    /bar_cache_instrument_timeframe_source_starts_at_idx|bar_cache_symbol_timeframe_source_starts_at_idx/,
  );
});
