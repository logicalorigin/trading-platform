import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("wave one compact strips use packed intrinsic tracks", () => {
  const flowInlineSource = readLocalSource("../features/flow/ContractDetailInline.jsx");
  const diagnosticsSource = readLocalSource("./DiagnosticsScreen.jsx");
  const cashFundingSource = readLocalSource("./account/CashFundingPanel.jsx");

  assert.ok(
    flowInlineSource.includes('data-testid="flow-inline-execution-quality"') &&
      flowInlineSource.includes(
        "gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(110)}px), max-content))`,",
      ) &&
      flowInlineSource.includes('justifyContent: "start",'),
    "Expected flow inline execution quality facts to pack to intrinsic width",
  );

  assert.ok(
    diagnosticsSource.includes(
      "gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(110)}px), max-content))`, justifyContent: \"start\"",
    ),
    "Expected diagnostics chart-scope facts to pack to intrinsic width",
  );

  assert.ok(
    cashFundingSource.includes('data-testid="account-cash-summary-grid"') &&
      cashFundingSource.includes(
        "gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${dim(120)}px), max-content))`,",
      ) &&
      cashFundingSource.includes('justifyContent: "start",'),
    "Expected account cash summary metrics to pack to intrinsic width",
  );

});
