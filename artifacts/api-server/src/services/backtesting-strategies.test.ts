import assert from "node:assert/strict";
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
