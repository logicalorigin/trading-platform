import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resolveIbkrWatchlistFillerSymbolLimit,
  resolveIbkrWatchlistPrewarmSymbolLimit,
} from "./platform";

const ENV_NAME = "IBKR_WATCHLIST_PREWARM_MAX_SYMBOLS";
const originalValue = process.env[ENV_NAME];

afterEach(() => {
  if (originalValue === undefined) {
    delete process.env[ENV_NAME];
  } else {
    process.env[ENV_NAME] = originalValue;
  }
});

test("watchlist prewarm defaults to a 30-symbol primary prewarm cap", () => {
  delete process.env[ENV_NAME];

  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 30);
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(12), 12);
});

test("watchlist prewarm env override can lower or raise the primary cap", () => {
  process.env[ENV_NAME] = "24";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 24);

  process.env[ENV_NAME] = "120";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 90);
});

test("watchlist filler respects total and equity bridge slack", () => {
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: 90,
      nonFillerEquityLineCount: 45,
    }),
    45,
  );
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 120,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: 90,
      nonFillerEquityLineCount: 45,
    }),
    20,
  );
  assert.equal(
    resolveIbkrWatchlistFillerSymbolLimit({
      candidateSymbolCount: 80,
      targetFillLines: 190,
      nonFillerLineCount: 100,
      bridgeEquityLineBudget: null,
      nonFillerEquityLineCount: 45,
    }),
    80,
  );
});
