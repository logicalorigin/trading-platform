import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { __snapTradeHistorySchedulerInternalsForTests } from "./snaptrade-history-scheduler";

test("SnapTrade scheduled history refresh reports exact failures without a hidden retry stack", async () => {
  const refs = [
    { accountId: "account-a", appUserId: "user-a" },
    { accountId: "account-b", appUserId: "user-b" },
    { accountId: "account-c", appUserId: "user-c" },
  ];
  const attempts: string[] = [];
  const result = await __snapTradeHistorySchedulerInternalsForTests.refreshAccounts(
    refs,
    async ({ accountId }) => {
      attempts.push(accountId);
      if (accountId !== "account-a") {
        throw new Error("database write failed");
      }
      return { activitiesStored: 3 };
    },
  );

  assert.deepEqual(attempts, ["account-a", "account-b", "account-c"]);
  assert.deepEqual(result.summary, {
    accounts: 3,
    succeeded: 1,
    failed: 2,
    activitiesStored: 3,
  });
  assert.deepEqual(
    result.outcomes.map(({ status, ref }) => ({
      status,
      accountId: ref.accountId,
    })),
    [
      { status: "succeeded", accountId: "account-a" },
      { status: "failed", accountId: "account-b" },
      { status: "failed", accountId: "account-c" },
    ],
  );

  const source = readFileSync(
    new URL("./snaptrade-history-scheduler.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(source, /refreshAccountsWithRetry|failedAccountRefs/);
});

test("broker history background entry points own the bulk DB lane", () => {
  const snapTradeSource = readFileSync(
    new URL("./snaptrade-history-scheduler.ts", import.meta.url),
    "utf8",
  );
  const robinhoodSource = readFileSync(
    new URL("./robinhood-history-scheduler.ts", import.meta.url),
    "utf8",
  );

  for (const source of [snapTradeSource, robinhoodSource]) {
    const connectStart = source.indexOf(
      "export async function refresh",
    );
    const allStart = source.indexOf(
      "\nexport async function refreshAll",
      connectStart,
    );
    const onReadStart = source.indexOf(
      "\nexport function refresh",
      allStart,
    );
    const schedulerStart = source.indexOf(
      "\nexport function start",
      onReadStart,
    );

    assert.notEqual(connectStart, -1);
    assert.notEqual(allStart, -1);
    assert.notEqual(onReadStart, -1);
    assert.notEqual(schedulerStart, -1);
    assert.match(
      source.slice(connectStart, allStart),
      /return runInDbLane\(\s*"bulk",\s*async \(\) =>/,
    );
    assert.match(
      source.slice(allStart, onReadStart),
      /return runInDbLane\(\s*"bulk",\s*async \(\) =>/,
    );
    assert.match(
      source.slice(onReadStart, schedulerStart),
      /const refresh = runInDbLane\(\s*"bulk",\s*\(\) =>\s*ingest/,
    );
  }
});
