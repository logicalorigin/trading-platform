import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { HttpError } from "../lib/errors";
import {
  __resetIbkrHistoricalAdmissionForTests,
  getIbkrHistoricalAdmissionSnapshot,
  runIbkrHistoricalRequest,
} from "./ibkr-historical-admission";

const ENV_KEYS = [
  "IBKR_HISTORICAL_API_CONCURRENCY",
  "IBKR_HISTORICAL_API_QUEUE_CAP",
  "IBKR_HISTORICAL_API_MAX_WAIT_MS",
  "IBKR_TWS_REQUEST_RATE_PER_SECOND",
  "IBKR_HISTORICAL_GLOBAL_WINDOW_MS",
  "IBKR_HISTORICAL_GLOBAL_WINDOW_MAX",
  "IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS",
  "IBKR_HISTORICAL_SAME_CONTRACT_WINDOW_MS",
  "IBKR_HISTORICAL_SAME_CONTRACT_MAX",
] as const;

const previousEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);

function setEnv(values: Record<string, string>): void {
  ENV_KEYS.forEach((key) => {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
}

afterEach(() => {
  __resetIbkrHistoricalAdmissionForTests();
  ENV_KEYS.forEach((key) => {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  });
});

test("historical admission rejects identical background requests inside cooldown", async () => {
  setEnv({
    IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS: "1000",
    IBKR_HISTORICAL_GLOBAL_WINDOW_MAX: "100",
  });

  const input = {
    family: "signal-matrix",
    priority: 4,
    symbol: "SPY",
    timeframe: "1m",
    source: "trades",
  };

  assert.equal(await runIbkrHistoricalRequest(input, async () => "ok"), "ok");
  await assert.rejects(
    () => runIbkrHistoricalRequest(input, async () => "blocked"),
    (error) =>
      error instanceof HttpError &&
      error.code === "ibkr_historical_admission_rejected" &&
      (error.data as { reason?: string }).reason === "identical-request-cooldown",
  );

  const snapshot = getIbkrHistoricalAdmissionSnapshot();
  assert.equal(snapshot.rejected, 1);
  assert.equal(snapshot.families["signal-matrix"]?.rejected, 1);
});

test("historical admission lets visible work wait for short pacing delays", async () => {
  setEnv({
    IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS: "20",
    IBKR_HISTORICAL_API_MAX_WAIT_MS: "100",
    IBKR_HISTORICAL_GLOBAL_WINDOW_MAX: "100",
  });

  const input = {
    family: "chart",
    priority: 6,
    symbol: "QQQ",
    timeframe: "1m",
    source: "trades",
  };

  assert.equal(await runIbkrHistoricalRequest(input, async () => 1), 1);
  assert.equal(await runIbkrHistoricalRequest(input, async () => 2), 2);

  const snapshot = getIbkrHistoricalAdmissionSnapshot();
  assert.equal(snapshot.accepted, 2);
  assert.equal(snapshot.rejected, 0);
});

test("historical admission applies ten minute pacing only to small bars", async () => {
  setEnv({
    IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS: "1",
    IBKR_HISTORICAL_GLOBAL_WINDOW_MAX: "1",
    IBKR_HISTORICAL_SAME_CONTRACT_MAX: "100",
  });

  assert.equal(
    await runIbkrHistoricalRequest(
      { family: "signal-matrix", priority: 4, symbol: "SPY", timeframe: "1m" },
      async () => "first-large-bar",
    ),
    "first-large-bar",
  );
  assert.equal(
    await runIbkrHistoricalRequest(
      { family: "signal-matrix", priority: 4, symbol: "QQQ", timeframe: "5m" },
      async () => "second-large-bar",
    ),
    "second-large-bar",
  );

  __resetIbkrHistoricalAdmissionForTests();
  setEnv({
    IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS: "1",
    IBKR_HISTORICAL_GLOBAL_WINDOW_MAX: "1",
    IBKR_HISTORICAL_SAME_CONTRACT_MAX: "100",
  });

  assert.equal(
    await runIbkrHistoricalRequest(
      { family: "chart", priority: 4, symbol: "SPY", timeframe: "30s" },
      async () => "first-small-bar",
    ),
    "first-small-bar",
  );
  await assert.rejects(
    () =>
      runIbkrHistoricalRequest(
        { family: "chart", priority: 4, symbol: "QQQ", timeframe: "30s" },
        async () => "second-small-bar",
      ),
    (error) =>
      error instanceof HttpError &&
      error.code === "ibkr_historical_admission_rejected" &&
      (error.data as { reason?: string }).reason === "global-historical-pacing",
  );
});

test("historical admission rejects when bounded api queue is full", async () => {
  setEnv({
    IBKR_HISTORICAL_API_CONCURRENCY: "1",
    IBKR_HISTORICAL_API_QUEUE_CAP: "1",
    IBKR_HISTORICAL_API_MAX_WAIT_MS: "1000",
    IBKR_HISTORICAL_IDENTICAL_COOLDOWN_MS: "1",
    IBKR_HISTORICAL_GLOBAL_WINDOW_MAX: "100",
  });

  let releaseFirst = () => {};
  const first = runIbkrHistoricalRequest(
    { family: "signal-monitor-worker", priority: 4, symbol: "AAPL", timeframe: "1m" },
    () =>
      new Promise<string>((resolve) => {
        releaseFirst = () => resolve("first");
      }),
  );
  const second = runIbkrHistoricalRequest(
    { family: "signal-monitor-worker", priority: 4, symbol: "MSFT", timeframe: "1m" },
    async () => "second",
  );

  await assert.rejects(
    () =>
      runIbkrHistoricalRequest(
        { family: "signal-monitor-worker", priority: 4, symbol: "NVDA", timeframe: "1m" },
        async () => "third",
      ),
    (error) =>
      error instanceof HttpError &&
      error.code === "ibkr_historical_admission_rejected" &&
      (error.data as { reason?: string }).reason === "api-historical-queue-full",
  );

  releaseFirst();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
});
