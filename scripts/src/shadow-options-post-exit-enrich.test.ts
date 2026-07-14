import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { __shadowOptionsPostExitEnrichInternalsForTests as enrich } from "./shadow-options-post-exit-enrich";

const ISOLATED_DATABASE_ENV = {
  DATABASE_URL:
    "postgresql://post-exit-test:unused@127.0.0.1:1/post-exit-test?connect_timeout=1",
  LOCAL_DATABASE_URL: "",
  PGDATABASE: "",
  PGHOST: "",
  PGPASSWORD: "",
  PGPORT: "",
  PGUSER: "",
  PYRUS_DATABASE_SOURCE: "database_url",
};

const scriptPath = resolve(
  import.meta.dirname,
  "shadow-options-post-exit-enrich.ts",
);

const runCli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env: { ...process.env, ...ISOLATED_DATABASE_ENV },
    timeout: 30_000,
  });

test("importing the post-exit enricher does not run database or provider work", () => {
  const moduleUrl = pathToFileURL(
    resolve(import.meta.dirname, "shadow-options-post-exit-enrich.ts"),
  ).href;
  const imported = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`,
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      env: { ...process.env, ...ISOLATED_DATABASE_ENV },
      timeout: 30_000,
    },
  );

  assert.equal(
    imported.status,
    0,
    `import unexpectedly ran the enricher:\n${imported.stdout}${imported.stderr}`,
  );
});

test("invalid CLI input fails before database work without exposing a stack", () => {
  const result = runCli(["--unknown=true"]);

  assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
  assert.match(result.stderr, /Usage:/u);
  assert.doesNotMatch(result.stderr, /ECONNREFUSED|127\.0\.0\.1|\n\s+at /u);
});

test("CLI accepts only canonical, unambiguous date windows", () => {
  const defaults = enrich.readConfig([]);
  assert.equal(defaults.from.toISOString(), "2026-05-22T00:00:00.000Z");
  assert.equal(defaults.to.toISOString(), "2026-07-07T23:59:59.999Z");

  const explicit = enrich.readConfig([
    "--from=2026-06-01",
    "--to",
    "2026-06-30",
  ]);
  assert.equal(explicit.from.toISOString(), "2026-06-01T00:00:00.000Z");
  assert.equal(explicit.to.toISOString(), "2026-06-30T23:59:59.999Z");

  for (const args of [
    ["--unknown=true"],
    ["--from=2026-06-01", "--from=2026-06-02"],
    ["--from=2026-02-30"],
    ["--to=07/07/2026"],
    ["--from=2026-07-08", "--to=2026-07-07"],
    ["positional"],
  ]) {
    assert.throws(() => enrich.readConfig(args), /Usage:/u);
  }
});

test("payload parsing does not coerce malformed financial values or option rights", () => {
  assert.equal(enrich.finiteNumber(1.25), 1.25);
  for (const value of [null, undefined, "", "1.25", false, [], {}]) {
    assert.equal(enrich.finiteNumber(value), null);
  }

  assert.equal(enrich.optionRight("call"), "call");
  assert.equal(enrich.optionRight("PUT"), "put");
  for (const value of [null, "", "C", "banana", 1]) {
    assert.equal(enrich.optionRight(value), null);
  }
});

test("diagnostics redact credentials and cannot control the terminal", () => {
  const diagnostic = enrich.errorMessage(
    new Error(
      `postgresql://operator:super-secret@db.example/pyrus?token=query-secret \u001b[31mline\nnext\u202e${"x".repeat(700)}`,
    ),
  );

  assert.match(diagnostic, /postgresql:\/\/\[redacted\]@db\.example\/pyrus/u);
  assert.doesNotMatch(diagnostic, /super-secret|query-secret/u);
  assert.doesNotMatch(
    diagnostic,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(diagnostic.length <= 500);
});

const postExitOutcome = {
  bars: 2,
  highPrice: 1.5,
  highAt: "2026-06-02T14:31:00.000Z",
  lowPrice: 0.9,
  lowAt: "2026-06-02T14:32:00.000Z",
  lastClose: 1.1,
  lastAt: "2026-06-02T14:32:00.000Z",
  highVsExitPct: 50,
  lastVsExitPct: 10,
  recoveredEntry: true,
  reachedTwentyFivePctGain: true,
  reachedFiftyPctGain: true,
  finalAboveExit: true,
  finalAboveEntry: true,
};

const exitRow = {
  event_id: "00000000-0000-4000-8000-000000000001",
  deployment_id: "00000000-0000-4000-8000-000000000002",
  symbol: "SPY",
  occurred_at: new Date("2026-06-02T14:30:00.000Z"),
  event_payload: {},
  order_id: "00000000-0000-4000-8000-000000000003",
  order_payload: {},
  event_has_outcome: false,
  order_has_outcome: false,
};

test("existing outcomes are reused across mirrors and conflicts fail closed", () => {
  assert.deepEqual(
    enrich.selectExistingOutcome({
      ...exitRow,
      order_payload: { postExitOutcome },
    }),
    {
      outcome: postExitOutcome,
      eventPresent: false,
      orderPresent: true,
    },
  );
  assert.deepEqual(
    enrich.selectExistingOutcome({
      ...exitRow,
      event_payload: { postExitOutcome },
      order_payload: { postExitOutcome: { ...postExitOutcome } },
    }),
    {
      outcome: postExitOutcome,
      eventPresent: true,
      orderPresent: true,
    },
  );
  assert.throws(
    () =>
      enrich.selectExistingOutcome({
        ...exitRow,
        event_payload: { postExitOutcome: {} },
      }),
    /invalid existing post-exit outcome/i,
  );
  assert.throws(
    () =>
      enrich.selectExistingOutcome({
        ...exitRow,
        event_payload: { postExitOutcome: { bars: "2" } },
      }),
    /invalid existing post-exit outcome/i,
  );
  assert.throws(
    () =>
      enrich.selectExistingOutcome({
        ...exitRow,
        event_payload: { postExitOutcome },
        order_payload: {
          postExitOutcome: { ...postExitOutcome, highPrice: 99 },
        },
      }),
    /conflicting post-exit outcomes/i,
  );
});

test("event and order outcome writes share one transaction", async () => {
  const legacyPool = pool as unknown as {
    query: (...args: unknown[]) => Promise<never>;
  };
  const originalQuery = legacyPool.query;
  legacyPool.query = async () => {
    throw new Error("legacy direct pool query used");
  };

  const statements: string[] = [];
  let released = false;
  const fakePool = {
    async connect() {
      return {
        async query(sql: string) {
          const normalized = sql.trim().replace(/\s+/gu, " ");
          statements.push(normalized);
          if (/^select payload/iu.test(normalized)) {
            return { rowCount: 1, rows: [{ payload: {} }] };
          }
          return {
            rowCount: /^update /iu.test(normalized) ? 1 : null,
            rows: [],
          };
        },
        release() {
          released = true;
        },
      };
    },
  };

  try {
    const updated = await (
      enrich.updateMissingOutcome as unknown as (
        row: typeof exitRow,
        outcome: Record<string, unknown>,
        transactionPool: typeof fakePool,
      ) => Promise<{ eventUpdated: number; orderUpdated: number }>
    )(exitRow, postExitOutcome, fakePool);

    assert.deepEqual(updated, { eventUpdated: 1, orderUpdated: 1 });
    assert.equal(statements[0]?.toLowerCase(), "begin");
    assert.match(
      statements[1] ?? "",
      /^select payload from execution_events.+for update$/iu,
    );
    assert.match(
      statements[2] ?? "",
      /^select payload from shadow_orders.+for update$/iu,
    );
    assert.match(statements[3] ?? "", /^update execution_events/iu);
    assert.match(statements[4] ?? "", /^update shadow_orders/iu);
    assert.equal(statements.at(-1)?.toLowerCase(), "commit");
    assert.equal(released, true);
  } finally {
    legacyPool.query = originalQuery;
  }
});

test("a concurrently stored outcome becomes authoritative before mirror writes", async () => {
  const concurrentOutcome = { ...postExitOutcome, highPrice: 1.75 };
  const writtenOutcomes: unknown[] = [];
  const fakePool = {
    async connect() {
      return {
        async query(sql: string, values?: unknown[]) {
          const normalized = sql.trim().replace(/\s+/gu, " ");
          if (/^select payload from execution_events/iu.test(normalized)) {
            return {
              rowCount: 1,
              rows: [{ payload: { postExitOutcome: concurrentOutcome } }],
            };
          }
          if (/^select payload from shadow_orders/iu.test(normalized)) {
            return { rowCount: 1, rows: [{ payload: {} }] };
          }
          if (/^update execution_events/iu.test(normalized)) {
            return { rowCount: 0, rows: [] };
          }
          if (/^update shadow_orders/iu.test(normalized)) {
            writtenOutcomes.push(JSON.parse(String(values?.[1])));
            return { rowCount: 1, rows: [] };
          }
          return { rowCount: null, rows: [] };
        },
        release() {},
      };
    },
  };

  const updated = await (
    enrich.updateMissingOutcome as unknown as (
      row: typeof exitRow,
      outcome: Record<string, unknown>,
      transactionPool: typeof fakePool,
    ) => Promise<{ eventUpdated: number; orderUpdated: number }>
  )(exitRow, postExitOutcome, fakePool);

  assert.deepEqual(updated, { eventUpdated: 0, orderUpdated: 1 });
  assert.deepEqual(writtenOutcomes, [concurrentOutcome]);
});

test("a failed mirror update rolls back without masking the primary error", async () => {
  const legacyPool = pool as unknown as {
    query: (...args: unknown[]) => Promise<never>;
  };
  const originalQuery = legacyPool.query;
  legacyPool.query = async () => {
    throw new Error("legacy direct pool query used");
  };
  const statements: string[] = [];
  let released = false;
  const fakePool = {
    async connect() {
      return {
        async query(sql: string) {
          const normalized = sql.trim().replace(/\s+/gu, " ");
          statements.push(normalized);
          if (/^select payload/iu.test(normalized)) {
            return { rowCount: 1, rows: [{ payload: {} }] };
          }
          if (/^update shadow_orders/iu.test(normalized)) {
            throw new Error("shadow mirror unavailable");
          }
          return {
            rowCount: /^update /iu.test(normalized) ? 1 : null,
            rows: [],
          };
        },
        release() {
          released = true;
        },
      };
    },
  };

  try {
    await assert.rejects(
      (
        enrich.updateMissingOutcome as unknown as (
          row: typeof exitRow,
          outcome: Record<string, unknown>,
          transactionPool: typeof fakePool,
        ) => Promise<unknown>
      )(exitRow, postExitOutcome, fakePool),
      /shadow mirror unavailable/u,
    );
    assert.equal(statements.at(-1)?.toLowerCase(), "rollback");
    assert.equal(
      statements.some((statement) => statement.toLowerCase() === "commit"),
      false,
    );
    assert.equal(released, true);
  } finally {
    legacyPool.query = originalQuery;
  }
});

test("post-exit outcomes reject invalid prices and capped bar coverage", async () => {
  const row = {
    ...exitRow,
    event_payload: {
      exitPrice: 1,
      position: { entryPrice: 1 },
      selectedContract: {
        underlying: "SPY",
        expirationDate: "2026-06-19",
        strike: 500,
        right: "call",
        ticker: "O:SPY260619C00500000",
      },
    },
  };
  const config = {
    from: new Date("2026-06-01T00:00:00.000Z"),
    to: new Date("2026-06-30T23:59:59.999Z"),
  };
  type ComputeOutcome = (
    exit: typeof row,
    dateWindow: typeof config,
    getBars: () => Promise<Record<string, unknown>>,
  ) => Promise<{
    outcome: Record<string, unknown> | null;
    reason: string | null;
  }>;
  const computeOutcome =
    enrich.computeOutcomeForRow as unknown as ComputeOutcome;
  let invalidPriceRequests = 0;
  const invalidPrice = await computeOutcome(
    {
      ...row,
      event_payload: {
        ...row.event_payload,
        position: { entryPrice: 0 },
      },
    },
    config,
    async () => {
      invalidPriceRequests += 1;
      throw new Error(
        "provider should not be called for an invalid entry price",
      );
    },
  );
  assert.deepEqual(invalidPrice, {
    outcome: null,
    reason: "missing_contract_or_price",
  });
  assert.equal(invalidPriceRequests, 0);

  const cappedBars = Array.from({ length: 5_000 }, (_, index) => ({
    timestamp: new Date(exitRow.occurred_at.getTime() + (index + 1) * 60_000),
    high: 1.5,
    low: 0.8,
    close: 1.1,
  }));
  const capped = await computeOutcome(row, config, async () => ({
    bars: cappedBars,
    emptyReason: null,
    debug: { capped: false, complete: undefined },
    historyPage: { providerPageLimitReached: false },
  }));

  assert.deepEqual(capped, {
    outcome: null,
    reason: "incomplete_option_bar_coverage",
  });

  const complete = await computeOutcome(row, config, async () => ({
    bars: [
      {
        timestamp: new Date("2026-06-02T14:31:00.000Z"),
        high: 2,
        low: 0.8,
        close: 1.5,
      },
      {
        timestamp: new Date("2026-06-02T14:32:00.000Z"),
        high: 1.6,
        low: 0.9,
        close: 1.2,
      },
    ],
    emptyReason: null,
    debug: { capped: false, complete: true },
    historyPage: { providerPageLimitReached: false },
  }));
  assert.equal(complete.reason, null);
  assert.equal(complete.outcome?.highPrice, 2);
  assert.equal(complete.outcome?.bars, 2);
});

test("historical exit scans stop at a finite row ceiling", async () => {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const query = async (sql: string, values: unknown[]) => {
    calls.push({ sql, values });
    return { rows: Array.from({ length: 10_001 }, () => exitRow) };
  };
  const internals = enrich as unknown as {
    loadExitRows: (
      config: { from: Date; to: Date },
      executeQuery: typeof query,
    ) => Promise<Array<typeof exitRow>>;
  };

  await assert.rejects(
    internals.loadExitRows(
      {
        from: new Date("2026-06-01T00:00:00.000Z"),
        to: new Date("2026-06-30T23:59:59.999Z"),
      },
      query,
    ),
    /exceeded the 10,000-row safety ceiling/u,
  );
  assert.match(calls[0]?.sql ?? "", /limit \$3/iu);
  assert.equal(calls[0]?.values[2], 10_001);
});
