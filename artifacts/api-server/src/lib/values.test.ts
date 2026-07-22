import assert from "node:assert/strict";
import test from "node:test";

import { toDate } from "./values";

test("toDate rejects impossible compact calendar dates", () => {
  assert.equal(toDate("20260229"), null);
  assert.equal(toDate(20260431), null);
  assert.equal(toDate("20261301"), null);
});

test("toDate accepts valid compact calendar dates", () => {
  assert.equal(toDate("20240229")?.toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(toDate(20260430)?.toISOString(), "2026-04-30T00:00:00.000Z");
});
