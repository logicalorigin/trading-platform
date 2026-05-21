import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  resolveIbkrWatchlistFillerSymbolLimit,
  resolveIbkrWatchlistPrewarmSymbolLimit,
} from "./platform";

const PREWARM_LIMIT_ENV_NAME = "IBKR_WATCHLIST_PREWARM_MAX_SYMBOLS";
const FILLER_ENABLED_ENV_NAME = "IBKR_MARKET_DATA_ENABLE_FILLER_PREWARM";
const originalValues = new Map(
  [PREWARM_LIMIT_ENV_NAME, FILLER_ENABLED_ENV_NAME].map((name) => [
    name,
    process.env[name],
  ]),
);

afterEach(() => {
  for (const [name, value] of originalValues) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

test("watchlist prewarm defaults to a 30-symbol primary prewarm cap", () => {
  delete process.env[PREWARM_LIMIT_ENV_NAME];

  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 30);
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(12), 12);
});

test("watchlist prewarm env override can lower or raise the primary cap", () => {
  process.env[PREWARM_LIMIT_ENV_NAME] = "24";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 24);

  process.env[PREWARM_LIMIT_ENV_NAME] = "120";
  assert.equal(resolveIbkrWatchlistPrewarmSymbolLimit(90), 90);
});

test("watchlist filler is enabled by default and fills available slack", () => {
  delete process.env[FILLER_ENABLED_ENV_NAME];

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
});

test("watchlist filler respects total and equity bridge slack when enabled", () => {
  process.env[FILLER_ENABLED_ENV_NAME] = "true";

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
