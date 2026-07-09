import assert from "node:assert/strict";
import test from "node:test";

import { buildMassiveDirectUrl, fetchMassiveDirectJson } from "./index";

test("Massive pagination cannot send the API key to another origin", () => {
  const priorKey = process.env.MASSIVE_API_KEY;
  const priorBaseUrl = process.env.MASSIVE_API_BASE_URL;
  process.env.MASSIVE_API_KEY = "secret";
  process.env.MASSIVE_API_BASE_URL = "https://api.massive.com";

  try {
    const url = buildMassiveDirectUrl(
      "https://api.massive.com/v2/aggs?cursor=next",
      {},
    );
    assert.equal(url.searchParams.get("apiKey"), "secret");
    assert.throws(
      () => buildMassiveDirectUrl("https://evil.invalid/page", {}),
      /changed origin/,
    );
    assert.throws(
      () => buildMassiveDirectUrl("http://api.massive.com/page", {}),
      /changed origin/,
    );
    process.env.MASSIVE_API_BASE_URL = "https://api.massive.com/proxy";
    assert.equal(buildMassiveDirectUrl("/v2/aggs", {}).pathname, "/proxy/v2/aggs");
  } finally {
    if (priorKey === undefined) delete process.env.MASSIVE_API_KEY;
    else process.env.MASSIVE_API_KEY = priorKey;
    if (priorBaseUrl === undefined) delete process.env.MASSIVE_API_BASE_URL;
    else process.env.MASSIVE_API_BASE_URL = priorBaseUrl;
  }
});

test("Massive HTTP errors do not expose the API key", async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return new Response("request failed: apiKey=dont-log-me", { status: 400 });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  await assert.rejects(
    fetchMassiveDirectJson(new URL("https://api.massive.com/?apiKey=dont-log-me")),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.doesNotMatch(error.message, /dont-log-me/);
      return true;
    },
  );
});
