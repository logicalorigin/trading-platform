import assert from "node:assert/strict";
import test from "node:test";

import { __marketIdentityLogoTestHooks } from "./marketIdentity.jsx";

const makeFetch = ({ pending = false } = {}) => {
  const calls = [];
  let resolvePending;
  const pendingPromise = pending
    ? new Promise((resolve) => {
        resolvePending = resolve;
      })
    : null;
  const fetch = async (url) => {
    calls.push(String(url));
    if (pendingPromise) {
      await pendingPromise;
    }
    const query = String(url).split("symbols=")[1] || "";
    const symbols = decodeURIComponent(query)
      .split(",")
      .map((symbol) => symbol.trim())
      .filter(Boolean);
    return {
      ok: true,
      json: async () => ({
        logos: symbols.map((symbol) => ({
          symbol,
          logoUrl: `https://logos.example/${symbol}.svg`,
        })),
      }),
    };
  };
  fetch.calls = calls;
  fetch.resolvePending = () => resolvePending?.();
  return fetch;
};

test("market identity logo requests coalesce while in flight", async () => {
  __marketIdentityLogoTestHooks.reset();
  const originalFetch = globalThis.fetch;
  const fetch = makeFetch({ pending: true });
  globalThis.fetch = fetch;
  try {
    const first = __marketIdentityLogoTestHooks.fetchTickerLogo("aapl");
    const second = __marketIdentityLogoTestHooks.fetchTickerLogo("AAPL");

    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(fetch.calls.length, 1);
    assert.equal(__marketIdentityLogoTestHooks.inFlightSize(), 1);

    fetch.resolvePending();
    const [firstLogo, secondLogo] = await Promise.all([first, second]);

    assert.equal(firstLogo, "https://logos.example/AAPL.svg");
    assert.equal(secondLogo, "https://logos.example/AAPL.svg");
    assert.equal(fetch.calls.length, 1);
    assert.equal(__marketIdentityLogoTestHooks.inFlightSize(), 0);
  } finally {
    globalThis.fetch = originalFetch;
    __marketIdentityLogoTestHooks.reset();
  }
});

test("market identity logo cache evicts oldest completed entries over capacity", async () => {
  __marketIdentityLogoTestHooks.reset();
  const originalFetch = globalThis.fetch;
  const fetch = makeFetch();
  globalThis.fetch = fetch;
  try {
    const maxEntries = __marketIdentityLogoTestHooks.cacheMaxEntries();
    const symbols = Array.from(
      { length: maxEntries + 1 },
      (_, index) => `SYM${String(index).padStart(3, "0")}`,
    );

    await Promise.all(
      symbols.map((symbol) => __marketIdentityLogoTestHooks.fetchTickerLogo(symbol)),
    );

    assert.equal(__marketIdentityLogoTestHooks.cacheSize(), maxEntries);
    assert.equal(__marketIdentityLogoTestHooks.hasCacheEntry(symbols[0]), false);
    assert.equal(__marketIdentityLogoTestHooks.hasCacheEntry(symbols[1]), true);
    assert.equal(
      __marketIdentityLogoTestHooks.hasCacheEntry(symbols[symbols.length - 1]),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    __marketIdentityLogoTestHooks.reset();
  }
});

test("market identity logo cache reads refresh recency", async () => {
  __marketIdentityLogoTestHooks.reset();
  const originalFetch = globalThis.fetch;
  const fetch = makeFetch();
  globalThis.fetch = fetch;
  try {
    const maxEntries = __marketIdentityLogoTestHooks.cacheMaxEntries();
    const symbols = Array.from(
      { length: maxEntries },
      (_, index) => `LRU${String(index).padStart(3, "0")}`,
    );

    await Promise.all(
      symbols.map((symbol) => __marketIdentityLogoTestHooks.fetchTickerLogo(symbol)),
    );
    assert.equal(fetch.calls.length, 1);

    assert.equal(
      await __marketIdentityLogoTestHooks.fetchTickerLogo(symbols[0]),
      `https://logos.example/${symbols[0]}.svg`,
    );
    assert.equal(fetch.calls.length, 1);

    await __marketIdentityLogoTestHooks.fetchTickerLogo("LRU_NEW");

    assert.equal(__marketIdentityLogoTestHooks.cacheSize(), maxEntries);
    assert.equal(__marketIdentityLogoTestHooks.hasCacheEntry(symbols[0]), true);
    assert.equal(__marketIdentityLogoTestHooks.hasCacheEntry(symbols[1]), false);
    assert.equal(__marketIdentityLogoTestHooks.hasCacheEntry("LRU_NEW"), true);
  } finally {
    globalThis.fetch = originalFetch;
    __marketIdentityLogoTestHooks.reset();
  }
});
