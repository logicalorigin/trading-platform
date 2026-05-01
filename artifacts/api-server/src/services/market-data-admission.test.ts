import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  __resetMarketDataAdmissionForTests,
  admitMarketDataLeases,
  getMarketDataAdmissionBudget,
  getMarketDataAdmissionDiagnostics,
} from "./market-data-admission";

const ENV_KEYS = [
  "IBKR_MARKET_DATA_APP_MAX_LINES",
  "IBKR_MARKET_DATA_RESERVE_LINES",
  "IBKR_MARKET_DATA_EXECUTION_LINES",
  "IBKR_MARKET_DATA_VISIBLE_LINES",
  "IBKR_MARKET_DATA_AUTOMATION_LINES",
  "IBKR_MARKET_DATA_FLOW_SCANNER_LINES",
  "IBKR_MARKET_DATA_CONVENIENCE_LINES",
] as const;

const originalEnv = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): void {
  ENV_KEYS.forEach((key) => {
    if (values[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = values[key];
    }
  });
}

afterEach(() => {
  __resetMarketDataAdmissionForTests();
  setEnv(originalEnv);
});

test("uses a 200-line IBKR budget with a 15-line reserve by default", () => {
  setEnv({});

  const budget = getMarketDataAdmissionBudget();
  assert.equal(budget.maxLines, 200);
  assert.equal(budget.reserveLines, 15);
  assert.equal(budget.usableLines, 185);
  assert.equal(budget.automationLineCap, 35);
  assert.equal(budget.flowScannerLineCap, 45);
  assert.deepEqual(budget.poolLineCaps, {
    execution: 12,
    visible: 70,
    automation: 35,
    "flow-scanner": 45,
    convenience: 23,
  });
});

test("counts option greeks as option plus shared underlying line", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
  });

  const result = admitMarketDataLeases({
    owner: "visible-chain",
    intent: "visible-live",
    requests: [
      { assetClass: "equity", symbol: "AAPL" },
      {
        assetClass: "option",
        providerContractId: "1001",
        underlying: "AAPL",
        requiresGreeks: true,
      },
      {
        assetClass: "option",
        providerContractId: "1002",
        underlying: "AAPL",
        requiresGreeks: true,
      },
    ],
  });

  assert.equal(result.admitted.length, 3);
  assert.equal(result.rejected.length, 0);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 3);
  assert.equal(diagnostics.activeEquityLineCount, 1);
  assert.equal(diagnostics.activeOptionLineCount, 2);
});

test("enforces the automation live-line cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_EXECUTION_LINES: "8",
    IBKR_MARKET_DATA_VISIBLE_LINES: "50",
    IBKR_MARKET_DATA_AUTOMATION_LINES: "18",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
    IBKR_MARKET_DATA_CONVENIENCE_LINES: "4",
  });

  const result = admitMarketDataLeases({
    owner: "automation-scan",
    intent: "automation-live",
    requests: Array.from({ length: 19 }, (_, index) => ({
      assetClass: "equity" as const,
      symbol: `AUTO${index}`,
    })),
  });

  assert.equal(result.admitted.length, 18);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "automation-cap");
  assert.equal(getMarketDataAdmissionDiagnostics().automationLineCount, 18);
});

test("enforces the flow scanner live-line cap", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "100",
    IBKR_MARKET_DATA_RESERVE_LINES: "10",
    IBKR_MARKET_DATA_FLOW_SCANNER_LINES: "10",
  });

  const result = admitMarketDataLeases({
    owner: "flow-scanner",
    intent: "flow-scanner-live",
    requests: Array.from({ length: 11 }, (_, index) => ({
      assetClass: "option" as const,
      providerContractId: `OPT${index}`,
      underlying: "SPY",
    })),
  });

  assert.equal(result.admitted.length, 10);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "pool-cap");
  assert.equal(getMarketDataAdmissionDiagnostics().flowScannerLineCount, 10);
});

test("higher-priority execution requests demote lower-priority convenience leases", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "3",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "watchlist",
    intent: "delayed-ok",
    requests: ["AAA", "BBB", "CCC"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "order-ticket",
    intent: "execution-live",
    requests: ["DDD", "EEE"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  assert.equal(result.admitted.length, 2);
  assert.equal(result.demoted.length, 2);
  const diagnostics = getMarketDataAdmissionDiagnostics();
  assert.equal(diagnostics.activeLineCount, 3);
  assert.equal(diagnostics.intentUsage["execution-live"], 2);
  assert.equal(diagnostics.intentUsage["delayed-ok"], 1);
});

test("rejects same-priority requests when the live-line budget is full", () => {
  setEnv({
    IBKR_MARKET_DATA_APP_MAX_LINES: "2",
    IBKR_MARKET_DATA_RESERVE_LINES: "0",
  });

  admitMarketDataLeases({
    owner: "visible-a",
    intent: "visible-live",
    requests: ["AAA", "BBB"].map((symbol) => ({
      assetClass: "equity" as const,
      symbol,
    })),
  });

  const result = admitMarketDataLeases({
    owner: "visible-b",
    intent: "visible-live",
    requests: [{ assetClass: "equity", symbol: "CCC" }],
  });

  assert.equal(result.admitted.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].reason, "budget");
  assert.equal(getMarketDataAdmissionDiagnostics().activeLineCount, 2);
});
