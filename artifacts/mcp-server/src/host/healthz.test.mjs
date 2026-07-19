import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../config.ts";
import { checkHealthz } from "./healthz.ts";

test("health failures return a fixed classification without configuration or exception details", async () => {
  const originalFetch = globalThis.fetch;
  const marker = "synthetic-health-secret";
  globalThis.fetch = async () => {
    throw new Error(marker);
  };

  try {
    const result = await checkHealthz();
    const serialized = JSON.stringify(result);

    assert.equal(result.url, "/api/healthz");
    assert.equal(result.error, "request_failed");
    assert.doesNotMatch(serialized, new RegExp(marker));
    assert.equal(serialized.includes(config.apiBaseUrl), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("non-2xx health responses retain status without exposing an upstream body", async () => {
  const originalFetch = globalThis.fetch;
  const marker = "synthetic-upstream-health-secret";
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: marker }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });

  try {
    const result = await checkHealthz();

    assert.deepEqual(result, {
      url: "/api/healthz",
      ok: false,
      status: 500,
      body: null,
      error: "http_error",
    });
    assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
