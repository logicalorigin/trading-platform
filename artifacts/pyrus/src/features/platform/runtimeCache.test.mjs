import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { hydrateQueryFromRuntimeCache } from "./runtimeCache.js";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

const assertHydrateCallOptsOutOfImmediateInvalidation = (source, label) => {
  assert.match(
    source,
    /hydrateQueryFromRuntimeCache\(\{\s*queryClient,\s*queryKey[\s\S]*?invalidate:\s*false,\s*\}\);/,
    `${label} should pass invalidate:false when the owning query handles freshness`,
  );
};

test("runtime cache hydration can avoid an immediate duplicate invalidation", async () => {
  let data = null;
  let invalidateCalls = 0;
  const queryClient = {
    getQueryData: () => data,
    invalidateQueries: () => {
      invalidateCalls += 1;
    },
    setQueryData: (_queryKey, nextData) => {
      data = nextData;
    },
  };

  const hydrated = await hydrateQueryFromRuntimeCache({
    queryClient,
    queryKey: ["runtime-cache-test"],
    read: async () => ({
      payload: { rows: [1, 2, 3] },
      meta: { cacheStatus: "hit" },
    }),
    invalidate: false,
  });

  assert.equal(hydrated, true);
  assert.deepEqual(data, {
    rows: [1, 2, 3],
    runtimeCache: { cacheStatus: "hit" },
  });
  assert.equal(invalidateCalls, 0);
});

test("warm-start runtime cache hydrate call sites opt out of duplicate invalidation", () => {
  assertHydrateCallOptsOutOfImmediateInvalidation(
    readLocalSource("../trade/TradeEquityPanel.jsx"),
    "TradeEquityPanel",
  );
  assertHydrateCallOptsOutOfImmediateInvalidation(
    readLocalSource("../charting/useOptionChartBars.js"),
    "useOptionChartBars",
  );
  assertHydrateCallOptsOutOfImmediateInvalidation(
    readLocalSource("../../screens/AccountScreen.jsx"),
    "AccountScreen",
  );
});
