import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");

test("API startup does not activate IBKR watchlist market-data prewarm", () => {
  assert.doesNotMatch(indexSource, /\bstartIbkrWatchlistPrewarmRuntime\b/);

  assert.match(indexSource, /attachIbkrPortalWebSocket\(server\)/);
  assert.match(indexSource, /\bstartAccountFlexRefreshScheduler\b/);
});
