import assert from "node:assert/strict";
import test from "node:test";

import { toToolText } from "./shape.ts";

test("small values pass through as full pretty JSON", () => {
  const value = { a: 1, b: ["x", "y"] };
  const text = toToolText(value, 32_768);
  assert.deepEqual(JSON.parse(text), value);
  assert.ok(!text.includes("_truncated"));
});

test("large arrays are capped under the byte limit with a note", () => {
  const value = { items: Array.from({ length: 10_000 }, (_, i) => ({ i, label: `row-${i}` })) };
  const maxBytes = 4_000;
  const text = toToolText(value, maxBytes);
  assert.ok(Buffer.byteLength(text, "utf8") <= maxBytes, "must fit the byte cap");
  assert.ok(text.includes("_truncated"), "must flag truncation");
  assert.ok(text.includes("more (truncated)"), "must mark dropped array items");
});

test("a single huge string falls back to a hard cut", () => {
  const value = { blob: "z".repeat(100_000) };
  const maxBytes = 2_000;
  const text = toToolText(value, maxBytes);
  assert.ok(Buffer.byteLength(text, "utf8") <= maxBytes, "hard cut respects the byte cap");
  assert.ok(text.includes("_truncated"));
});

test("a hard cut counts UTF-8 bytes instead of JavaScript characters", () => {
  const value = { blob: "😀".repeat(100_000) };
  const maxBytes = 2_000;
  const text = toToolText(value, maxBytes);
  assert.ok(Buffer.byteLength(text, "utf8") <= maxBytes, "multi-byte text respects the byte cap");
  assert.ok(text.includes("_truncated"));
});
