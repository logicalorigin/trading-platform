import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOT_WARM_START_CACHE_KEY,
  BOOT_WARM_START_FRESH_MS,
  readBootWarmStart,
  shouldRunStartupRefresh,
  writeBootWarmStart,
} from "./bootWarmStartCache.js";

const createStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
};

test("boot warm-start cache round-trips a fresh snapshot with environment", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-11T18:00:00.000Z");

  assert.equal(
    writeBootWarmStart({ environment: "live" }, { storage, nowMs }),
    true,
  );

  const cached = readBootWarmStart({ storage, nowMs: nowMs + 60_000 });
  assert.ok(cached);
  assert.equal(cached.environment, "live");
  assert.equal(cached.savedAt, nowMs);
});

test("boot warm-start cache expires snapshots past the fresh window", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-11T18:00:00.000Z");

  writeBootWarmStart({ environment: "shadow" }, { storage, nowMs });

  const cached = readBootWarmStart({
    storage,
    nowMs: nowMs + BOOT_WARM_START_FRESH_MS + 1,
  });
  assert.equal(cached, null);
  // Expired entry is evicted on read.
  assert.equal(storage.getItem(BOOT_WARM_START_CACHE_KEY), null);
});

test("boot warm-start cache rejects future-dated snapshots", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-11T18:00:00.000Z");

  writeBootWarmStart(
    { environment: "shadow" },
    { storage, nowMs: nowMs + 60_000 },
  );

  assert.equal(readBootWarmStart({ storage, nowMs }), null);
  assert.equal(storage.getItem(BOOT_WARM_START_CACHE_KEY), null);
});

test("boot warm-start cache returns null and clears corrupt JSON", () => {
  const storage = createStorage();
  storage.setItem(BOOT_WARM_START_CACHE_KEY, "{not-json");

  assert.equal(readBootWarmStart({ storage }), null);
  assert.equal(storage.getItem(BOOT_WARM_START_CACHE_KEY), null);
});

test("boot warm-start cache ignores unknown versions", () => {
  const storage = createStorage();
  storage.setItem(
    BOOT_WARM_START_CACHE_KEY,
    JSON.stringify({ version: 2, savedAt: Date.now(), environment: "shadow" }),
  );

  assert.equal(readBootWarmStart({ storage }), null);
});

test("boot warm-start cache normalizes an unrecognized environment to null", () => {
  const storage = createStorage();
  const nowMs = Date.parse("2026-06-11T18:00:00.000Z");

  writeBootWarmStart({ environment: "sandbox" }, { storage, nowMs });

  const cached = readBootWarmStart({ storage, nowMs: nowMs + 60_000 });
  assert.ok(cached);
  assert.equal(cached.environment, null);
});

test("startup refresh fanout still runs without a warm-start snapshot", () => {
  assert.equal(shouldRunStartupRefresh({ warmStart: null }), true);
});

test("startup refresh fanout is skipped for a usable warm-start snapshot", () => {
  assert.equal(
    shouldRunStartupRefresh({
      warmStart: {
        environment: "shadow",
        savedAt: Date.parse("2026-06-11T18:00:00.000Z"),
      },
    }),
    false,
  );
});
