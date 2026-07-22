import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { runWithPostgresDiagnosticContext } from "@workspace/db";
import {
  __appendAccountPositionsTimingForTests,
  __appendWorkGovernorTimingForTests,
  __getAccountPositionsTimingSummaryForTests,
  __recordMemorySampleForTests,
  __resetAccountPositionsTimingRateLimitForTests,
  __resetWorkGovernorTimingRateLimitForTests,
  flushRuntimeFlightRecorderBuffersSync,
  writeRuntimeFlightRecorderHeartbeat,
} from "./runtime-flight-recorder";

test("account position aggregates retain fast successes without per-request events", () => {
  __resetAccountPositionsTimingRateLimitForTests();
  try {
    __appendAccountPositionsTimingForTests(
      {
        detail: "fast",
        liveQuotes: false,
        outcome: "success",
        universeCache: "hit",
        positionsCache: "hit",
        positionCount: 2,
        rowCount: 2,
        stagesMs: { universe: 5, positions_upstream: 10 },
        totalDurationMs: 80,
      },
      1_000,
    );
    __appendAccountPositionsTimingForTests(
      {
        detail: "fast",
        liveQuotes: false,
        outcome: "success",
        universeCache: "miss",
        positionsCache: "miss",
        positionCount: 2,
        rowCount: 2,
        stagesMs: { universe: 100, positions_upstream: 150 },
        totalDurationMs: 320,
      },
      2_000,
    );

    const summary = __getAccountPositionsTimingSummaryForTests();
    assert.equal(summary.total.count, 2);
    assert.equal(summary.total.successCount, 2);
    assert.equal(summary.total.sub250SuccessCount, 1);
    assert.equal(summary.total.durationMs.buckets.le250, 1);
    assert.equal(summary.total.durationMs.buckets.le500, 2);
    assert.equal(summary.total.universeCache.hit, 1);
    assert.equal(summary.total.universeCache.miss, 1);
    assert.equal(summary.total.stagesMs.universe?.count, 2);
    assert.equal(summary.families["fast:quotes-off"]?.count, 2);
  } finally {
    __resetAccountPositionsTimingRateLimitForTests();
  }
});

test("slow position and broker-governor events share sanitized request correlation", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-position-correlation-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetAccountPositionsTimingRateLimitForTests();
  __resetWorkGovernorTimingRateLimitForTests();

  try {
    runWithPostgresDiagnosticContext(
      {
        requestId: "req-positions-1",
        path: "/api/accounts/private-account/positions",
        route: "GET /api/accounts/private-account/positions",
        routeClass: "interactive",
        requestFamily: "account-positions",
        clientRole: "account-screen",
        fetchPriority: 2,
        requestOrigin: "account",
        admissionAction: "admit",
      },
      () => {
        __appendAccountPositionsTimingForTests(
          {
            detail: "fast",
            liveQuotes: false,
            outcome: "success",
            universeCache: "miss",
            positionsCache: "miss",
            positionCount: 1,
            rowCount: 1,
            stagesMs: { positions_ibkr: 280 },
            totalDurationMs: 300,
          },
          1_000,
        );
        __appendWorkGovernorTimingForTests(
          {
            category: "account",
            operation: "positions",
            outcome: "success",
            queued: true,
            queueWaitMs: 120,
            executionDurationMs: 180,
            totalDurationMs: 300,
          },
          1_000,
        );
      },
    );
    flushRuntimeFlightRecorderBuffersSync();

    const events = readdirSync(recorderDir)
      .filter(
        (name) => name.startsWith("api-events-") && name.endsWith(".jsonl"),
      )
      .flatMap((name) =>
        readFileSync(path.join(recorderDir, name), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    const positions = events.find(
      (event) => event.event === "api-account-positions-timing",
    );
    const governor = events.find(
      (event) => event.event === "api-work-governor-timing",
    );

    for (const event of [positions, governor]) {
      assert.equal(event.correlation.requestId, "req-positions-1");
      assert.equal(event.correlation.requestFamily, "account-positions");
      assert.equal(event.correlation.routeClass, "interactive");
      assert.equal("path" in event.correlation, false);
      assert.equal("route" in event.correlation, false);
      assert.equal(JSON.stringify(event).includes("private-account"), false);
    }
  } finally {
    __resetAccountPositionsTimingRateLimitForTests();
    __resetWorkGovernorTimingRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("heartbeats retain the bounded account-position timing summary", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(
    path.join(tmpdir(), "pyrus-position-summary-"),
  );
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;
  __resetAccountPositionsTimingRateLimitForTests();

  try {
    __appendAccountPositionsTimingForTests({
      detail: "fast",
      liveQuotes: false,
      outcome: "success",
      universeCache: "hit",
      positionsCache: "hit",
      positionCount: 2,
      rowCount: 2,
      stagesMs: { universe: 5, positions_upstream: 10 },
      totalDurationMs: 80,
    });

    const heartbeat = writeRuntimeFlightRecorderHeartbeat();
    const summary = heartbeat?.accountPositions as {
      total?: { count?: number; sub250SuccessCount?: number };
    };
    assert.equal(summary.total?.count, 1);
    assert.equal(summary.total?.sub250SuccessCount, 1);
  } finally {
    __resetAccountPositionsTimingRateLimitForTests();
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});

test("memory samples preserve shared, auth, and trading pool lanes", () => {
  const previousRecorderDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  const recorderDir = mkdtempSync(path.join(tmpdir(), "pyrus-pool-lanes-"));
  process.env["PYRUS_FLIGHT_RECORDER_DIR"] = recorderDir;

  const lane = (active: number, waiting: number, max: number) => ({
    active,
    waiting,
    totalWaiting: waiting,
    rawPoolWaiting: waiting,
    admissionWaiting: 0,
    appPoolSaturated: active >= max,
    max,
  });

  try {
    __recordMemorySampleForTests({
      dbPool: {
        ...lane(12, 3, 12),
        admissionWaiting: 7,
        totalWaiting: 10,
        authPool: lane(2, 1, 2),
        tradingPool: lane(1, 0, 3),
      },
    });
    flushRuntimeFlightRecorderBuffersSync();

    const events = readdirSync(recorderDir)
      .filter(
        (name) => name.startsWith("api-events-") && name.endsWith(".jsonl"),
      )
      .flatMap((name) =>
        readFileSync(path.join(recorderDir, name), "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line)),
      );
    const sample = events.find((event) => event.event === "api-memory-sample");
    assert.equal(sample.dbPool.rawPoolWaiting, 3);
    assert.equal(sample.dbPool.admissionWaiting, 7);
    assert.equal(sample.dbPool.authPool.rawPoolWaiting, 1);
    assert.equal(sample.dbPool.authPool.appPoolSaturated, true);
    assert.equal(sample.dbPool.tradingPool.rawPoolWaiting, 0);
    assert.equal(sample.dbPool.tradingPool.appPoolSaturated, false);
  } finally {
    if (previousRecorderDir === undefined) {
      delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
    } else {
      process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousRecorderDir;
    }
    rmSync(recorderDir, { recursive: true, force: true });
  }
});
