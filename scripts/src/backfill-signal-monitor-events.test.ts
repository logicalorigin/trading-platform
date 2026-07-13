import assert from "node:assert/strict";
import test from "node:test";
import {
  signalMonitorEventsTable,
  signalMonitorProfilesTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import {
  assertBackfillSourceEnabled,
  assertBackfillUniverseWritable,
  backfillUniverseFailureReason,
  backfillScanDisposition,
  commitBackfillCandidates,
  findExistingSignalMonitorProfile,
  parseBackfillArgs,
  scanCandidates,
  selectBackfillSymbols,
  type Candidate,
  type ScanFailure,
} from "./backfill-signal-monitor-events";

const NOW = new Date("2026-07-13T16:00:00.000Z");
const FROM = new Date("2026-07-12T14:30:00.000Z");

function matrixState(input: {
  symbol: string;
  evaluatedAt: Date;
  fresh?: boolean;
  barsSinceSignal?: number;
  partial?: boolean;
  trusted?: boolean;
}) {
  return {
    symbol: input.symbol,
    timeframe: "5m" as const,
    fresh: input.fresh ?? true,
    barsSinceSignal: input.barsSinceSignal ?? 0,
    canonicalSignalEvent: {
      signal: {
        id: `${input.symbol}-signal`,
        eventType: "buy_signal",
        barIndex: 1,
        price: 101,
        close: 102,
        filterState: { score: 1 },
      },
      signalAt: FROM,
      signalBarAt: new Date(FROM.getTime() - 5 * 60_000),
      latestBarAt: input.evaluatedAt,
      latestBarAnchorAt: input.evaluatedAt,
      sourceBarPartial: input.partial ?? false,
      sourceIntegrity: {
        trusted: input.trusted ?? true,
        reason: input.trusted === false ? "source-mismatch" : null,
      },
    },
  };
}

function candidate(symbol: string, index = 0): Candidate {
  const signalAt = new Date(FROM.getTime() + index * 1_000);
  return {
    eventKey: `backfill-test:${index}:${symbol}`,
    symbol,
    timeframe: "5m",
    direction: "buy",
    signalAt,
    signalBarAt: new Date(signalAt.getTime() - 5 * 60_000),
    signalPrice: 101,
    close: 102,
    payload: {
      backfill: "signal-monitor-events",
      sourceIntegrity: { trusted: true, reason: null },
    },
  };
}

function scanFailure(): ScanFailure {
  return {
    symbol: "QQQ",
    timeframe: "5m",
    evaluatedAt: FROM.toISOString(),
    error: "history unavailable",
    code: "invalid_history",
    status: 400,
    retryable: false,
    attempts: 1,
    resolution:
      "Fix the reported source or data error, then rerun this exact scope.",
  };
}

test("CLI parsing binds scope and requires explicit write confirmations", () => {
  assert.deepEqual(
    parseBackfillArgs(
      [
        "--",
        "--from=2026-07-12T14:30:00Z",
        "--to",
        "2026-07-12T16:00:00Z",
        "--timeframes=5m,15m,5m",
        "--symbols=spy, QQQ,brk-b",
        "--max-symbols=3",
        "--quiet",
      ],
      NOW,
    ),
    {
      environment: "shadow",
      from: new Date("2026-07-12T14:30:00Z"),
      to: new Date("2026-07-12T16:00:00Z"),
      timeframes: ["5m", "15m"],
      symbols: ["SPY", "QQQ", "BRK.B"],
      maxSymbols: 3,
      write: false,
      progress: false,
    },
  );
  assert.equal(
    parseBackfillArgs(
      [
        "--from=2026-07-12T14:30:00Z",
        "--environment=live",
        "--write",
        "--confirm-write",
        "--confirm-live",
      ],
      NOW,
    )?.write,
    true,
  );
  assert.equal(parseBackfillArgs(["--help"], NOW), null);

  for (const args of [
    ["--from=2026-07-12T14:30:00Z", "--typo"],
    ["--from=2026-07-12T14:30:00Z", "--from=2026-07-12T15:00:00Z"],
    ["--from=2026-07-12T14:30:00Z", "--symbols="],
    ["--from=2026-07-12T14:30:00Z", "--symbols=SPY,,QQQ"],
    ["--from=2026-07-12T14:30:00Z", `--symbols=${"X".repeat(33)}`],
    ["--from=2026-07-12T14:30:00Z", "--symbols=SPY\u0007"],
    ["--from=2026-07-12T14:30:00Z", "--timeframes="],
    ["--from=2026-07-12T14:30:00Z", "--timeframes=5m,,15m"],
    ["--from=2026-07-12T14:30:00Z", "--max-symbols=1.5"],
    ["--from=2026-07-12T14:30:00"],
    ["--from=2026-02-30T14:30:00Z"],
    ["--from=2026-07-12T14:30:00Z", "--write"],
    ["--from=2026-07-12T14:30:00Z", "--confirm-write"],
    [
      "--from=2026-07-12T14:30:00Z",
      "--environment=live",
      "--write",
      "--confirm-write",
    ],
    [
      "--from=2026-07-12T14:30:00Z",
      "--write",
      "--confirm-write",
      "--confirm-live",
    ],
  ]) {
    assert.throws(() => parseBackfillArgs(args, NOW));
  }
});

test("bar evaluation is an actionable preflight instead of one failure per cell", () => {
  assert.doesNotThrow(() =>
    assertBackfillSourceEnabled({
      PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED: "true",
    }),
  );
  assert.throws(
    () => assertBackfillSourceEnabled({}),
    /PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED=true/,
  );
});

test("symbol selection never turns an empty scope into a successful full backfill", () => {
  assert.deepEqual(
    selectBackfillSymbols(["spy", "SPY", " qqq ", "brk-b", "BRK.B"], [], null),
    ["SPY", "QQQ", "BRK.B"],
  );
  assert.deepEqual(selectBackfillSymbols(null, ["spy", "QQQ"], 1), ["SPY"]);
  assert.throws(
    () => selectBackfillSymbols(null, [], null),
    /resolved no symbols/i,
  );
});

test("a degraded resolved universe is a write blocker with an explicit-symbol recovery", () => {
  assert.equal(backfillUniverseFailureReason(null), null);
  assert.equal(
    backfillUniverseFailureReason({
      fallbackUsed: true,
      universe: { degradedReason: "ranking\u0007 data\nunavailable\u202e" },
    }),
    "ranking data unavailable Pass --symbols explicitly after verifying the intended repair scope.",
  );
  assert.equal(
    backfillUniverseFailureReason({
      fallbackUsed: true,
      universe: { degradedReason: null },
    }),
    "The profile universe used fallback data. Pass --symbols explicitly after verifying the intended repair scope.",
  );
  assert.equal(
    backfillUniverseFailureReason({
      fallbackUsed: false,
      universe: { degradedReason: "\u0007" },
    }),
    "Unknown source failure Pass --symbols explicitly after verifying the intended repair scope.",
  );
  const failure = backfillUniverseFailureReason({
    fallbackUsed: true,
    universe: { degradedReason: "ranking data unavailable" },
  });
  assert.doesNotThrow(() => assertBackfillUniverseWritable(false, failure));
  assert.throws(
    () => assertBackfillUniverseWritable(true, failure),
    /Pass --symbols explicitly/,
  );
});

test("profile lookup is read-only and fails when the requested profile is absent", async () => {
  await withTestDb(async ({ db }) => {
    await assert.rejects(
      findExistingSignalMonitorProfile("shadow"),
      /profile is missing/i,
    );
    assert.equal(
      (await db.select().from(signalMonitorProfilesTable)).length,
      0,
    );
  });
});

test("scan keeps only live-writer-eligible events and preserves trust evidence", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow", freshWindowBars: 3 })
      .returning();
    assert.ok(profile);

    const result = await scanCandidates(
      {
        profile,
        symbols: ["TRUST", "PARTIAL", "UNTRUST", "OLD"],
        timeframes: ["5m"],
        from: FROM,
        to: FROM,
        progress: false,
      },
      {
        loadCompletedBars: async () => ({ bars: [] }) as never,
        evaluateState: ({ symbol, evaluatedAt }) =>
          matrixState({
            symbol,
            evaluatedAt,
            partial: symbol === "PARTIAL",
            trusted: symbol !== "UNTRUST",
            fresh: symbol !== "OLD",
            barsSinceSignal: symbol === "OLD" ? 4 : 0,
          }) as never,
        sleep: async () => undefined,
      },
    );

    assert.deepEqual(
      result.candidates.map((candidate) => candidate.symbol),
      ["TRUST"],
    );
    assert.deepEqual(result.candidates[0]?.payload.sourceIntegrity, {
      trusted: true,
      reason: null,
    });
    assert.deepEqual(result.ineligible, {
      total: 3,
      reasons: {
        not_fresh: 1,
        partial_source_bar: 1,
        untrusted_source_bar: 1,
      },
    });
  });
});

test("scan retries transient source failures and diagnoses permanent failures", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow", freshWindowBars: 3 })
      .returning();
    assert.ok(profile);

    let attempts = 0;
    const sleeps: number[] = [];
    const recovered = await scanCandidates(
      {
        profile,
        symbols: ["SPY"],
        timeframes: ["5m"],
        from: FROM,
        to: FROM,
        progress: false,
      },
      {
        loadCompletedBars: async () => {
          attempts += 1;
          if (attempts <= 2) {
            throw Object.assign(new Error("provider busy"), {
              code: "upstream_http_error",
              statusCode: 503,
            });
          }
          return { bars: [] } as never;
        },
        evaluateState: ({ symbol, evaluatedAt }) =>
          matrixState({ symbol, evaluatedAt }) as never,
        sleep: async (milliseconds) => {
          sleeps.push(milliseconds);
        },
      },
    );
    assert.deepEqual(sleeps, [250, 1_000]);
    assert.deepEqual(recovered.retries, { attempted: 2, recovered: 1 });
    assert.equal(recovered.unrecoverable.length, 0);
    assert.equal(recovered.candidates.length, 1);

    const permanentError = Object.assign(
      new Error("\u001b[31mmissing\nconfiguration"),
      {
        code: "massive_not_configured",
        statusCode: 503,
      },
    );
    let permanentAttempts = 0;
    const failed = await scanCandidates(
      {
        profile,
        symbols: ["QQQ"],
        timeframes: ["5m"],
        from: FROM,
        to: FROM,
        progress: false,
      },
      {
        loadCompletedBars: async () => {
          permanentAttempts += 1;
          throw permanentError;
        },
        evaluateState: () => {
          throw new Error("unreachable");
        },
        sleep: async () => undefined,
      },
    );
    assert.equal(permanentAttempts, 1);
    assert.equal(failed.unrecoverable.length, 1);
    assert.deepEqual(
      {
        code: failed.unrecoverable[0]?.code,
        status: failed.unrecoverable[0]?.status,
        retryable: failed.unrecoverable[0]?.retryable,
        attempts: failed.unrecoverable[0]?.attempts,
      },
      {
        code: "massive_not_configured",
        status: 503,
        retryable: false,
        attempts: 1,
      },
    );
    assert.equal(failed.unrecoverable[0]?.error, "missing configuration");
    assert.match(failed.unrecoverable[0]?.resolution ?? "", /MASSIVE_API_KEY/);
  });
});

test("an exhausted systemic retry stops the scan instead of failing every cell", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow" })
      .returning();
    assert.ok(profile);
    let attempts = 0;
    const result = await scanCandidates(
      {
        profile,
        symbols: ["SPY", "QQQ"],
        timeframes: ["5m"],
        from: FROM,
        to: FROM,
        progress: false,
      },
      {
        loadCompletedBars: async () => {
          attempts += 1;
          throw Object.assign(new Error("database unavailable"), {
            code: "ECONNRESET",
            statusCode: 503,
          });
        },
        evaluateState: () => {
          throw new Error("unreachable");
        },
        sleep: async () => undefined,
      },
    );
    assert.equal(attempts, 3);
    assert.deepEqual(result.retries, { attempted: 2, recovered: 0 });
    assert.equal(result.unrecoverable.length, 1);
    assert.equal(result.unrecoverable[0]?.symbol, "SPY");
  });
});

test("an incomplete scan never triggers follow-on row-count queries", () => {
  assert.deepEqual(backfillScanDisposition(false, 0), {
    scanComplete: true,
    writeBlocked: false,
    queryExisting: true,
  });
  assert.deepEqual(backfillScanDisposition(false, 1), {
    scanComplete: false,
    writeBlocked: false,
    queryExisting: false,
  });
  assert.deepEqual(backfillScanDisposition(true, 1), {
    scanComplete: false,
    writeBlocked: true,
    queryExisting: false,
  });
});

test("commit is atomic, idempotent, and preserves source-integrity evidence", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({
        environment: "shadow",
        freshWindowBars: 3,
        pyrusSignalsSettings: { timeHorizon: 8 },
      })
      .returning();
    assert.ok(profile);
    const event = candidate("SPY");

    assert.deepEqual(
      await commitBackfillCandidates({
        profile,
        candidates: [event],
        unrecoverable: [],
      }),
      { existing: 0, missing: 1, inserted: 1 },
    );
    const rows = await db.select().from(signalMonitorEventsTable);
    assert.equal(rows.length, 1);
    assert.deepEqual(
      (rows[0]?.payload as Record<string, unknown>).sourceIntegrity,
      { trusted: true, reason: null },
    );
    assert.deepEqual(
      await commitBackfillCandidates({
        profile,
        candidates: [event],
        unrecoverable: [],
      }),
      { existing: 1, missing: 0, inserted: 0 },
    );
  });
});

test("unresolved scan gaps publish no events", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow" })
      .returning();
    assert.ok(profile);

    await assert.rejects(
      commitBackfillCandidates({
        profile,
        candidates: [candidate("SPY")],
        unrecoverable: [scanFailure()],
      }),
      /unresolved scan gap/i,
    );
    assert.equal((await db.select().from(signalMonitorEventsTable)).length, 0);
  });
});

test("commit refuses a candidate without affirmative trust evidence", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow" })
      .returning();
    assert.ok(profile);
    const untrusted = candidate("SPY");
    untrusted.payload.sourceIntegrity = {
      trusted: false,
      reason: "source-mismatch",
    };

    await assert.rejects(
      commitBackfillCandidates({
        profile,
        candidates: [untrusted],
        unrecoverable: [],
      }),
      /trusted source evidence/i,
    );
    assert.equal((await db.select().from(signalMonitorEventsTable)).length, 0);
  });
});

test("profile settings changed after scanning publish no events", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({
        environment: "shadow",
        pyrusSignalsSettings: { timeHorizon: 2 },
      })
      .returning();
    assert.ok(profile);
    await db
      .update(signalMonitorProfilesTable)
      .set({ pyrusSignalsSettings: { timeHorizon: 8 } });

    await assert.rejects(
      commitBackfillCandidates({
        profile,
        candidates: [candidate("SPY")],
        unrecoverable: [],
      }),
      /changed after the scan/i,
    );
    assert.equal((await db.select().from(signalMonitorEventsTable)).length, 0);
  });
});

test("a late insert failure rolls back earlier event batches", async () => {
  await withTestDb(async ({ db }) => {
    const [profile] = await db
      .insert(signalMonitorProfilesTable)
      .values({ environment: "shadow" })
      .returning();
    assert.ok(profile);
    const candidates = Array.from({ length: 251 }, (_value, index) =>
      candidate(index === 250 ? "X".repeat(33) : `S${index}`, index),
    );

    await assert.rejects(
      commitBackfillCandidates({
        profile,
        candidates,
        unrecoverable: [],
      }),
    );
    assert.equal((await db.select().from(signalMonitorEventsTable)).length, 0);
  });
});
