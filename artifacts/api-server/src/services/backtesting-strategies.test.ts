import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ListBacktestStrategiesResponse } from "@workspace/api-zod";

process.env["DATABASE_URL"] ??= "postgres://test:test@127.0.0.1:5432/test";

test("backtest strategy metadata satisfies the public API contract", async () => {
  const { listBacktestStrategies } = await import("./backtesting");
  const response = ListBacktestStrategiesResponse.parse(listBacktestStrategies());

  assert.ok(response.strategies.length > 0);
  for (const strategy of response.strategies) {
    for (const definition of strategy.parameterDefinitions) {
      assert.ok("min" in definition);
      assert.ok("max" in definition);
      assert.ok("step" in definition);
      assert.ok(Array.isArray(definition.options));

      if (definition.type === "integer" || definition.type === "number") {
        assert.equal(typeof definition.min, "number");
        assert.equal(typeof definition.max, "number");
        assert.equal(typeof definition.step, "number");
      } else {
        assert.equal(definition.min, null);
        assert.equal(definition.max, null);
        assert.equal(definition.step, null);
      }
    }
  }
});

test("Pyrus Signals strategy defaults to the selected 5m signal horizon", async () => {
  const { listBacktestStrategies } = await import("./backtesting");
  const response = ListBacktestStrategiesResponse.parse(listBacktestStrategies());
  const strategy = response.strategies.find(
    (candidate) => candidate.strategyId === "pyrus_signals",
  );
  const timeHorizon = strategy?.parameterDefinitions.find(
    (definition) => definition.key === "timeHorizon",
  );

  assert.equal(strategy?.defaultParameters.timeHorizon, 8);
  assert.equal(timeHorizon?.defaultValue, 8);
  assert.ok(strategy?.supportedTimeframes.includes("5m"));
});

test("backtesting responses and run creation normalize retired algo branding", () => {
  const source = readFileSync(new URL("./backtesting.ts", import.meta.url), "utf8");

  assert.match(source, /normalizeBacktestStrategyId/);
  assert.match(source, /normalizeLegacyAlgoBrandText/);
  assert.match(source, /normalizeLegacyAlgoBranding/);
  assert.match(source, /strategyId = normalizeBacktestStrategyId\(input\.strategyId\)/);
  assert.match(source, /strategyId = normalizeBacktestStrategyId\(study\.strategyId\)/);
  assert.match(source, /strategyId = normalizeBacktestStrategyId\(run\.strategyId\)/);
  assert.doesNotMatch(source, /source:\s*run\.strategyId/);
  assert.doesNotMatch(source, /strat:\s*run\.strategyId/);
});
