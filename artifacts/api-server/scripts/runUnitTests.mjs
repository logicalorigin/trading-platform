#!/usr/bin/env node

import { spawn } from "node:child_process";

const unitTestFiles = [
  "../../lib/account-math/src/index.test.ts",
  "../../lib/backtest-core/src/engine.test.ts",
  "src/lib/runtime.test.ts",
  "src/providers/ibkr/bridge-client.test.ts",
  "src/providers/polygon/market-data.test.ts",
  "src/routes/platform-activation-origin.test.ts",
  "src/services/account-ranges.test.ts",
  "src/services/account-equity-history.test.ts",
  "src/services/account-positions.test.ts",
  "src/services/account-flex.test.ts",
  "src/services/account-list.test.ts",
  "src/services/account-orders.test.ts",
  "src/services/account-risk.test.ts",
  "src/services/account-snapshot-persistence.test.ts",
  "src/services/account-trade-annotations.test.ts",
  "src/services/backtesting-strategies.test.ts",
  "src/services/diagnostics.test.ts",
  "src/services/flow-events-model.test.ts",
  "src/services/gex.test.ts",
  "src/services/historical-flow-events.test.ts",
  "src/services/flow-premium-distribution.test.ts",
  "src/services/bridge-governor.test.ts",
  "src/services/bridge-option-quote-stream.test.ts",
  "src/services/ibkr-bridge-runtime.test.ts",
  "src/services/runtime-diagnostics.test.ts",
  "src/services/order-read-resilience.test.ts",
  "src/lib/transient-db-error.test.ts",
  "src/services/option-order-intent.test.ts",
  "src/services/order-gateway-readiness.test.ts",
  "src/services/trade-monitor-worker.test.ts",
  "src/services/signal-monitor.test.ts",
  "src/services/signal-options-worker.test.ts",
  "src/services/algo-gateway.test.ts",
  "src/services/market-data-admission.test.ts",
  "src/services/market-data-store.test.ts",
  "src/services/market-identity.test.ts",
  "src/services/nasdaq-symbol-directory.test.ts",
  "src/services/stock-aggregate-stream.test.ts",
  "src/services/option-chain-batch.test.ts",
  "src/services/signal-options-automation.test.ts",
  "src/services/shadow-account.test.ts",
  "src/services/shadow-equity-forward-worker.test.ts",
  "src/services/flow-universe.test.ts",
  "src/services/options-flow-scanner.test.ts",
  "src/services/ibkr-lane-policy.test.ts",
  "src/services/ibkr-line-usage.test.ts",
  "src/services/bridge-quote-stream.test.ts",
  "src/services/user-preferences-model.test.ts",
  "src/ws/options-quotes.test.ts",
  "../ibkr-bridge/src/app.test.ts",
  "../ibkr-bridge/src/tws-provider.test.ts",
];

const childEnv = { ...process.env };
delete childEnv.REPLIT_LD_LIBRARY_PATH;
delete childEnv.LD_LIBRARY_PATH;

const child = spawn(
  process.execPath,
  ["--import", "tsx", "--test", ...unitTestFiles],
  {
    env: childEnv,
    stdio: "inherit",
  },
);

child.on("error", (error) => {
  console.error(error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
