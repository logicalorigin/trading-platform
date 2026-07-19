import assert from "node:assert/strict";
import test from "node:test";

import { capToolText, toToolText } from "./shape.ts";

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

test("unserializable values return a byte-capped sentinel", () => {
  const value = {
    toJSON() {
      throw new Error("JSON serialization failed");
    },
    [Symbol.toPrimitive]() {
      throw new Error("string coercion failed");
    },
  };
  const maxBytes = 8;

  assert.equal(toToolText(value, maxBytes), capToolText("[unserializable]", maxBytes));
});

test("a getter that fails during array capping returns the unserializable sentinel", () => {
  let reads = 0;
  const value = {
    blob: "z".repeat(1_000),
    get unstable() {
      reads += 1;
      if (reads === 1) return "first pass";
      throw new Error("second traversal failed");
    },
  };

  assert.equal(toToolText(value, 128), "[unserializable]");
  assert.equal(reads, 2);
});
