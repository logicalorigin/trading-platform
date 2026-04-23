import assert from "node:assert/strict";
import test from "node:test";
import { searchUniverseTickers } from "../../artifacts/api-server/src/services/platform";
import {
  searchUniverseCatalog,
  upsertUniverseCatalogRows,
} from "../../artifacts/api-server/src/services/platform";

test(
  "persisted universe catalog returns fast exact and company-name matches after live seeding",
  { timeout: 120_000 },
  async () => {
    const seeded = await searchUniverseTickers({
      search: "AAPL",
      markets: ["stocks"],
      active: true,
      limit: 10,
    });
    assert.ok(seeded.results.length > 0, "live search should seed at least one row");
    await upsertUniverseCatalogRows(seeded.results);

    const exactStartedAt = performance.now();
    const exact = await searchUniverseCatalog({
      normalizedSearch: "AAPL",
      requestedMarkets: ["stocks"],
      resultLimit: 10,
      active: true,
    });
    const exactElapsedMs = performance.now() - exactStartedAt;
    assert.equal(exact.results[0]?.ticker, "AAPL");
    assert.equal(exact.results[0]?.market, "stocks");
    assert.equal(exact.results[0]?.tradeProvider, "ibkr");
    assert.ok(exact.results[0]?.providerContractId);
    assert.ok(
      exactElapsedMs <= 250,
      `catalog exact ticker lookup should be fast; got ${Math.round(exactElapsedMs)}ms`,
    );

    const nameStartedAt = performance.now();
    const byName = await searchUniverseCatalog({
      normalizedSearch: "Apple",
      requestedMarkets: ["stocks"],
      resultLimit: 10,
      active: true,
    });
    const nameElapsedMs = performance.now() - nameStartedAt;
    assert.equal(byName.results[0]?.ticker, "AAPL");
    assert.equal(byName.results[0]?.market, "stocks");
    assert.ok(
      nameElapsedMs <= 250,
      `catalog company-name lookup should be fast; got ${Math.round(nameElapsedMs)}ms`,
    );
  },
);
