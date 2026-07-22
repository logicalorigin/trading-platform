import assert from "node:assert/strict";
import test from "node:test";

import { shouldFallbackOptionChainToFullCoverage } from "./optionChainLoadingPlan.js";

const contractAt = (strike) => ({ contract: { strike } });

test("a close-review strike outside the active window forces full coverage", () => {
  assert.equal(
    shouldFallbackOptionChainToFullCoverage({
      activeRequest: { coverage: "window" },
      queryData: { contracts: [contractAt(95), contractAt(100), contractAt(105)] },
      queryIsSuccess: true,
      requiredStrike: 150,
    }),
    true,
  );
  assert.equal(
    shouldFallbackOptionChainToFullCoverage({
      activeRequest: { coverage: "window" },
      queryData: { contracts: [contractAt(95), contractAt(100), contractAt(105)] },
      queryIsSuccess: true,
      requiredStrike: 100,
    }),
    false,
  );
  assert.equal(
    shouldFallbackOptionChainToFullCoverage({
      activeRequest: { coverage: "full" },
      queryData: { contracts: [contractAt(100)] },
      queryIsSuccess: true,
      requiredStrike: 150,
    }),
    false,
  );
});
