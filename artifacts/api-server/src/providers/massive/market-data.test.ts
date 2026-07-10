import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMassiveProviderUrl,
  MassiveMarketDataClient,
} from "./market-data";

const config = {
  apiKey: "dont-log-me",
  baseUrl: "https://api.massive.com/proxy",
};

test("Massive URLs stay on the configured origin", () => {
  const url = buildMassiveProviderUrl(config, "/v2/aggs", { cursor: "next" });
  assert.equal(url.pathname, "/proxy/v2/aggs");
  assert.equal(url.searchParams.get("apiKey"), config.apiKey);
  assert.throws(
    () => buildMassiveProviderUrl(config, "https://evil.invalid/page"),
    /changed origin/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "http://api.massive.com/page"),
    /changed origin/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "../admin"),
    /left configured base path/,
  );
  assert.throws(
    () => buildMassiveProviderUrl(config, "https://api.massive.com/admin"),
    /left configured base path/,
  );
});

test("Massive failures do not expose the API key", async (t) => {
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.redirect, "error");
    return new Response(`request URL contained apiKey=${config.apiKey}`, {
      status: 400,
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  await assert.rejects(
    new MassiveMarketDataClient(config).getQuoteSnapshots(["SPY"]),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.doesNotMatch(`${error}\n${JSON.stringify(error)}`, /dont-log-me/);
      return true;
    },
  );
});

test("Massive request cancellation remains an AbortError", async (t) => {
  const priorFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();
  globalThis.fetch = async () => {
    throw new DOMException(`aborted ${config.apiKey}`, "AbortError");
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  await assert.rejects(
    new MassiveMarketDataClient(config).getUniverseTickerByTicker(
      "SPY",
      controller.signal,
    ),
    (error: unknown) => {
      assert(error instanceof Error);
      assert.equal(error.name, "AbortError");
      assert.doesNotMatch(error.message, /dont-log-me/);
      return true;
    },
  );
});

test("Massive logos are capped by streamed bytes", async (t) => {
  const priorFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    assert.equal(init?.redirect, "error");
    if (requests === 1) {
      return Response.json({
        results: {
          branding: {
            logo_url: "https://api.massive.com/proxy/v1/reference/logo",
          },
        },
      });
    }
    return new Response(new Uint8Array(250_001), {
      headers: { "content-type": "image/png" },
    });
  };
  t.after(() => {
    globalThis.fetch = priorFetch;
  });

  assert.equal(
    await new MassiveMarketDataClient(config).getTickerLogoUrl("SPY"),
    null,
  );
  assert.equal(requests, 2);
});
