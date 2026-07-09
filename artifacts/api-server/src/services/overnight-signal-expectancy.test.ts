import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import {
  backtestStudiesTable,
  backtestStudyJobsTable,
  signalUniverseRankingsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

import {
  createOvernightSignalExpectancyStudy,
  getOvernightSignalExpectancyResults,
} from "./backtesting";

test("overnight expectancy study snapshots member universe and queues the worker job", async () => {
  await withTestDb(async ({ db }) => {
    const rankedAt = new Date("2026-07-06T20:00:00.000Z");
    await db.insert(signalUniverseRankingsTable).values([
      {
        symbol: "BBB",
        score: "10",
        rank: 2,
        member: true,
        rankedAt,
      },
      {
        symbol: "AAA",
        score: "20",
        rank: 1,
        member: true,
        rankedAt,
      },
      {
        symbol: "ZZZ",
        score: "1",
        rank: 3,
        member: false,
        rankedAt,
      },
    ]);

    const created = await createOvernightSignalExpectancyStudy({
      name: "Overnight Test",
      signalTimeframes: ["15m", "30m", "1h", "4h"],
      startsAt: new Date("2026-06-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-01T23:59:59.000Z"),
    });

    assert.equal(created.status, "queued");
    const [study] = await db
      .select()
      .from(backtestStudiesTable)
      .where(eq(backtestStudiesTable.id, created.studyId));
    assert.ok(study);
    assert.equal(study.strategyId, "overnight_signal_expectancy");
    assert.equal(study.timeframe, "15m");
    assert.deepEqual(study.symbols, ["AAA", "BBB"]);

    const [job] = await db
      .select()
      .from(backtestStudyJobsTable)
      .where(eq(backtestStudyJobsTable.id, created.jobId));
    assert.equal(job?.kind, "overnight_signal_expectancy");

    const detail = await getOvernightSignalExpectancyResults(created.studyId);
    assert.ok(detail);
    assert.equal(detail.status, "queued");
    assert.deepEqual(detail.symbols, ["AAA", "BBB"]);
    assert.deepEqual(detail.results, []);
    assert.equal(
      (detail.parameters.universeSnapshot as { rankedAt?: string }).rankedAt,
      rankedAt.toISOString(),
    );
  });
});
