import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getGreekScenarioSummary,
  getRiskRecommendationSummary,
} from "./PortfolioExposurePanel.jsx";
import {
  buildSafeQaPortfolioExposureFixture,
  getSafeQaInitialQueryOptions,
} from "./accountSafeQaFixtures.js";

const source = readFileSync(new URL("../AccountScreen.jsx", import.meta.url), "utf8");

const walkObject = (value, visit) => {
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    visit(key, nested);
    walkObject(nested, visit);
  }
};

test("safe QA portfolio exposure fixture includes completed Greek shocks and option risk reviews", () => {
  const fixture = buildSafeQaPortfolioExposureFixture({ accountId: "shadow" });
  const greekSummary = getGreekScenarioSummary(fixture.risk.greekScenarios);
  const reviewSummary = getRiskRecommendationSummary(fixture.risk.riskRecommendations);
  const optionPositions = fixture.positions.positions.filter(
    (position) => position.assetClass === "option",
  );

  assert.equal(fixture.allocation.accountId, "shadow");
  assert.equal(fixture.risk.accountId, "shadow");
  assert.equal(fixture.positions.accountId, "shadow");
  assert.equal(optionPositions.length, 3);
  assert.equal(greekSummary.status, "completed");
  assert.equal(greekSummary.scenarioCount, 140);
  assert.equal(greekSummary.worst.estimatedPnl, -10217.5);
  assert.equal(greekSummary.best.estimatedPnl, 5210.25);
  assert.equal(greekSummary.flags[0].symbol, "SPY 515C");
  assert.equal(reviewSummary.status, "ready");
  assert.equal(reviewSummary.highestSeverity, "attention");
  assert.equal(reviewSummary.optionPositionCount, 3);
  assert.equal(reviewSummary.worstShockPnl, -10217.5);
  assert.ok(reviewSummary.recommendations.length >= 3);
});

test("safe QA option risk fixture remains review-only", () => {
  const fixture = buildSafeQaPortfolioExposureFixture({ accountId: "shadow" });
  const forbiddenKeys = new Set([
    "action",
    "contracts",
    "limitPrice",
    "order",
    "orderAction",
    "orderId",
    "quantity",
    "side",
  ]);
  const forbiddenCopy = /\b(buy|sell|submit|route|place order)\b/i;

  walkObject(fixture.risk.riskRecommendations, (key, value) => {
    assert.equal(
      forbiddenKeys.has(key),
      false,
      `safe QA risk fixture leaked trade-ticket key ${key}`,
    );
    if (typeof value === "string") {
      assert.equal(
        forbiddenCopy.test(value),
        false,
        `safe QA risk fixture leaked trade-action copy: ${value}`,
      );
    }
  });
});

test("safe QA query options seed React Query without enabling account requests", () => {
  const fixture = buildSafeQaPortfolioExposureFixture({ accountId: "shadow" });
  const options = getSafeQaInitialQueryOptions(fixture.risk);

  assert.equal(options.initialData, fixture.risk);
  assert.equal(options.enabled, false);
  assert.equal(options.refetchInterval, false);
  assert.equal(options.refetchOnMount, false);
  assert.equal(options.refetchOnReconnect, false);
  assert.equal(options.refetchOnWindowFocus, false);
  assert.equal(options.staleTime, Infinity);
});

test("AccountScreen wires safe QA fixture into exposure query data", () => {
  assert.match(source, /buildSafeQaPortfolioExposureFixture/);
  assert.match(source, /safeQaExposureFixture/);
  assert.match(source, /getSafeQaInitialQueryOptions\(safeQaExposureFixture\?\.summary\)/);
  assert.match(source, /getSafeQaInitialQueryOptions\(safeQaExposureFixture\?\.allocation\)/);
  assert.match(source, /getSafeQaInitialQueryOptions\(safeQaExposureFixture\?\.positions\)/);
  assert.match(source, /getSafeQaInitialQueryOptions\(safeQaExposureFixture\?\.risk\)/);
});

test("AccountScreen does not prefetch live account data in safe QA mode", () => {
  assert.match(source, /const accountQueriesEnabled = Boolean\([\s\S]*?!safeQaMode/);
  assert.match(
    source,
    /const prefetchAccountSectionLiveQueries = useCallback\(\s*\(section\) => \{\s*if \(!accountQueriesEnabled\) \{\s*return;\s*\}/,
  );
  assert.match(
    source,
    /const accountActivePrefetchEnabled = Boolean\(\s*accountQueriesEnabled[\s\S]*?useEffect\(\(\) => \{\s*if \(!accountActivePrefetchEnabled\) \{\s*return;\s*\}\s*prefetchAccountSectionLiveQueries\(accountSection\);/,
  );
});
