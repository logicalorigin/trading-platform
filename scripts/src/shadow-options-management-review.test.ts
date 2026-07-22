import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { __shadowOptionsManagementReviewInternalsForTests as review } from "./shadow-options-management-review";

const scriptSource = await readFile(
  new URL("./shadow-options-management-review.ts", import.meta.url),
  "utf8",
);

test("configuration is blank-safe and validates a canonical review window", () => {
  const config = review.readConfig(
    {
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_ACCOUNT_ID: "",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_START: "",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_END: "",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_REPORT_DIR: "",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_SWEEP_ROOT: "",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS: "",
    },
    "/repo/scripts",
    new Date("2026-07-14T12:34:56.789Z"),
  );

  assert.deepEqual(config, {
    accountId: "shadow",
    start: "2026-04-01",
    end: "2026-05-21",
    reportDir: path.resolve(
      "/repo/scripts",
      "reports/shadow-options-management-review/2026-07-14T12-34-56-789Z",
    ),
    topLeaks: 30,
    sweepRoot: path.resolve(
      "/repo/scripts",
      "reports/signal-options-exit-policy-sweeps",
    ),
  });

  for (const env of [
    { SHADOW_OPTIONS_MANAGEMENT_REVIEW_START: "2026-02-30" },
    { SHADOW_OPTIONS_MANAGEMENT_REVIEW_START: "2026-4-01" },
    {
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_START: "2026-05-22",
      SHADOW_OPTIONS_MANAGEMENT_REVIEW_END: "2026-05-21",
    },
    { SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS: "1e2" },
    { SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS: "251" },
  ]) {
    assert.throws(
      () => review.readConfig(env),
      /SHADOW_OPTIONS_MANAGEMENT_REVIEW|window/u,
    );
  }
});

test("external numeric parsing rejects coercive non-values", () => {
  for (const value of [null, undefined, "", "   ", true, false, [], [1], {}]) {
    assert.equal(review.finiteNumber(value), null);
  }
  assert.equal(review.finiteNumber("12.5"), 12.5);
  assert.equal(review.finiteNumber(12.5), 12.5);
});

test("sweep evidence accepts only an eligible succeeded ranked winner", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shadow-management-sweeps-"));
  const external = path.join(root, "external-results.json");
  const writeResult = async (name: string, body: unknown) => {
    const directory = path.join(root, name);
    await mkdir(directory);
    await writeFile(
      path.join(directory, "results.json"),
      `${JSON.stringify(body)}\n`,
      "utf8",
    );
  };

  try {
    await writeResult("eligible", {
      ranked: [
        {
          status: "succeeded",
          eligible: true,
          variant: { id: "eligible-winner" },
          metrics: {
            realizedPnl: 125,
            profitFactor: 2.5,
            closedTrades: 30,
            winRate: 0.6,
            maxDrawdownAbs: 10,
          },
          window: { start: "2026-05-01", end: "2026-05-02" },
        },
      ],
      results: [],
    });
    await writeResult("ineligible-fallback", {
      ranked: [],
      results: [
        {
          status: "succeeded",
          eligible: false,
          variant: { id: "ineligible-result" },
          metrics: { realizedPnl: 9_999, closedTrades: 1 },
        },
      ],
    });
    await writeResult("failed-ranked", {
      ranked: [
        {
          status: "failed",
          eligible: true,
          variant: { id: "failed-result" },
          metrics: { realizedPnl: 8_888, closedTrades: 30 },
        },
      ],
    });
    await writeFile(
      external,
      JSON.stringify({
        ranked: [
          {
            status: "succeeded",
            eligible: true,
            variant: { id: "symlinked-result" },
            metrics: { realizedPnl: 7_777, closedTrades: 30 },
          },
        ],
      }),
      "utf8",
    );
    await mkdir(path.join(root, "symlinked"));
    await symlink(external, path.join(root, "symlinked", "results.json"));

    const evidence = await review.readSweepEvidence(root);
    assert.deepEqual(
      evidence.map((item) => item.bestVariant),
      ["eligible-winner"],
    );
    assert.equal(evidence[0]?.window, "2026-05-01 through 2026-05-02");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("persisted JSON scalars are type-guarded before PostgreSQL casts", () => {
  assert.match(
    review.jsonNumberSql("o.payload", "{postExitOutcome,highPrice}"),
    /jsonb_typeof\(o\.payload #> '\{postExitOutcome,highPrice\}'\) = 'number'[\s\S]*::numeric/u,
  );
  assert.match(
    review.jsonBooleanSql("o.payload", "{postExitOutcome,finalAboveExit}"),
    /jsonb_typeof\(o\.payload #> '\{postExitOutcome,finalAboveExit\}'\) = 'boolean'[\s\S]*::boolean/u,
  );
  assert.doesNotMatch(
    scriptSource,
    /\(o\.payload #>> '\{[^']+\}'\)::(?:numeric|boolean|int|timestamptz)/u,
  );
});

test("management reports exclude forward-test ledger tombstones", () => {
  assert.equal(
    scriptSource.match(
      /lower\(coalesce\(o\.payload->>'forwardTest', 'false'\)\) <> 'true'/gu,
    )?.length,
    5,
  );
});

test("leak normalization does not coerce persisted boolean strings", () => {
  const normalized = review.normalizeLeakRow({
    symbol: "SPY",
    reason: "runner_trail_stop",
    closed_at: new Date("2026-05-01T12:00:00.000Z"),
    opened_at: "2026-05-01T11:30:00.000Z",
    pnl: "10",
    quantity: "2",
    exit_price: "1.5",
    final_above_exit: "false",
    recovered_entry: false,
  });

  assert.equal(normalized.finalAboveExit, null);
  assert.equal(normalized.recoveredEntry, false);
  assert.equal(normalized.holdMinutes, 30);
});

test("aggregate normalization rejects impossible financial evidence", () => {
  assert.throws(
    () =>
      review.normalizeAggregateRow({
        bucket: "runner_trail_stop",
        exits: 2,
        wins: 3,
        win_pct: 150,
        pnl: 10,
        avg_pnl: 5,
        missed_to_post_exit_high: 0,
        reached_25_after_exit: 0,
        final_above_exit: 0,
      }),
    /wins|win_pct/u,
  );
  assert.throws(
    () =>
      review.normalizeAggregateRow({
        bucket: "runner_trail_stop",
        exits: "not-a-number",
      }),
    /exits/u,
  );
});

test("ranked sweep evidence rejects impossible winner metrics", async () => {
  const root = await mkdtemp(
    path.join(tmpdir(), "shadow-management-invalid-sweep-"),
  );
  const directory = path.join(root, "invalid");
  await mkdir(directory);
  await writeFile(
    path.join(directory, "results.json"),
    JSON.stringify({
      ranked: [
        {
          status: "succeeded",
          eligible: true,
          variant: { id: "invalid-winner" },
          metrics: {
            realizedPnl: 100,
            profitFactor: -1,
            closedTrades: 30,
            winRate: 2,
            maxDrawdownAbs: -10,
          },
          window: { start: "2026-02-30", end: "2026-01-01" },
        },
      ],
    }),
    "utf8",
  );

  try {
    await assert.rejects(
      review.readSweepEvidence(root),
      /Invalid ranked sweep winner/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CSV, Markdown, terminal JSON, and errors contain untrusted strings", () => {
  assert.equal(review.csvCell("=1+1"), "'=1+1");
  assert.equal(review.csvCell("+cmd|'/C calc'!A0"), "'+cmd|'/C calc'!A0");
  assert.equal(review.csvCell(-12.5), "-12.5");

  const markdown = review.markdownText(
    "value|forged\n# heading <script> [link](https://bad.test)",
  );
  assert.doesNotMatch(markdown, /\n|<script>|\[link\]\(https:/u);
  assert.match(markdown, /\\\||&lt;script&gt;/u);

  const terminal = review.jsonText({
    value: "before\u2028middle\u2029after\u202e",
  });
  assert.doesNotMatch(terminal, /[\u2028\u2029\u202e]/u);
  const error = review.errorMessage(
    new Error(
      `postgres://operator:super-secret@db.test/review?apiKey=query-secret \u001b[31m\n${"x".repeat(2_000)}`,
    ),
  );
  assert.doesNotMatch(error, /super-secret|query-secret|\u001b|\n/u);
  assert.ok(error.length <= 1_000);
});

test("report files publish atomically and never overwrite prior evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "shadow-management-report-"));
  const reportDir = path.join(root, "report");
  const original = {
    "results.json": "original json\n",
    "top-leaks.csv": "original csv\n",
    "report.md": "original markdown\n",
  };

  try {
    await assert.doesNotReject(
      review.assertReportDestinationAvailable(reportDir),
    );
    await review.publishReportFiles(reportDir, original);
    assert.deepEqual((await readdir(reportDir)).sort(), [
      "report.md",
      "results.json",
      "top-leaks.csv",
    ]);
    await assert.rejects(
      review.assertReportDestinationAvailable(reportDir),
      /Report destination already exists/u,
    );
    await assert.rejects(
      review.publishReportFiles(reportDir, {
        "results.json": "replacement json\n",
        "top-leaks.csv": "replacement csv\n",
        "report.md": "replacement markdown\n",
      }),
    );
    assert.equal(
      await readFile(path.join(reportDir, "results.json"), "utf8"),
      original["results.json"],
    );
    assert.deepEqual(
      (await readdir(root)).filter((name) => name.includes(".tmp-")),
      [],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
