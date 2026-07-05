import assert from "node:assert/strict";
import test from "node:test";

import {
  __clearTreasuryYieldCurveCacheForTests,
  fetchTreasuryYieldCurveRates,
} from "./treasury-yield-curve";

delete process.env["TREASURY_YIELD_CURVE_URL"];

const OK_XML = `<?xml version="1.0"?>
<feed>
  <entry>
    <content>
      <m:properties>
        <d:NEW_DATE>2025-12-31T12:00:00Z</d:NEW_DATE>
        <d:BC_3MONTH>4.25</d:BC_3MONTH>
        <d:BC_10YEAR>4.10</d:BC_10YEAR>
      </m:properties>
    </content>
  </entry>
</feed>`;

const EMPTY_XML = `<?xml version="1.0"?><feed></feed>`;

function xmlResponse(body: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => body,
  } as unknown as Response;
}

function sequencedFetch(responses: Response[]): {
  urls: string[];
  fetchImpl: typeof fetch;
} {
  const urls: string[] = [];
  const queue = [...responses];
  const fetchImpl = (async (url: unknown) => {
    urls.push(String(url));
    const next = queue.shift();
    if (!next) {
      throw new Error("Unexpected extra fetch call.");
    }
    return next;
  }) as unknown as typeof fetch;
  return { urls, fetchImpl };
}

test("current-month empty falls back to previous month (January → prior December)", async () => {
  __clearTreasuryYieldCurveCacheForTests();
  const { urls, fetchImpl } = sequencedFetch([
    xmlResponse(EMPTY_XML),
    xmlResponse(OK_XML),
  ]);

  const result = await fetchTreasuryYieldCurveRates({
    asOf: new Date(Date.UTC(2026, 0, 15)),
    fetchImpl,
  });

  assert.equal(result.status, "ok");
  assert.equal(result.asOf, "2025-12-31");
  assert.deepEqual(result.points, [
    { tenorYears: 3 / 12, rate: 4.25 / 100 },
    { tenorYears: 10, rate: 4.1 / 100 },
  ]);
  assert.equal(urls.length, 2);
  assert.ok(urls[0]?.includes("field_tdr_date_value_month=202601"));
  assert.ok(urls[1]?.includes("field_tdr_date_value_month=202512"));
});

test("both months empty returns unavailable after one retry", async () => {
  __clearTreasuryYieldCurveCacheForTests();
  const { urls, fetchImpl } = sequencedFetch([
    xmlResponse(EMPTY_XML),
    xmlResponse(EMPTY_XML),
  ]);

  const result = await fetchTreasuryYieldCurveRates({
    asOf: new Date(Date.UTC(2026, 5, 1)),
    fetchImpl,
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.points.length, 0);
  assert.equal(urls.length, 2);
  assert.ok(urls[0]?.includes("field_tdr_date_value_month=202606"));
  assert.ok(urls[1]?.includes("field_tdr_date_value_month=202605"));
});

test("unavailable results expire after the short TTL", async () => {
  __clearTreasuryYieldCurveCacheForTests();
  let clock = 1_000_000;
  const now = () => clock;
  const asOf = new Date(Date.UTC(2026, 5, 15));

  const emptyBoth = sequencedFetch([
    xmlResponse(EMPTY_XML),
    xmlResponse(EMPTY_XML),
  ]);
  const first = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: emptyBoth.fetchImpl,
    now,
  });
  assert.equal(first.status, "unavailable");

  // Within the short TTL the unavailable result is served from cache.
  clock += 60 * 1000;
  const okFetch = sequencedFetch([xmlResponse(OK_XML)]);
  const cached = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: okFetch.fetchImpl,
    now,
  });
  assert.equal(cached.status, "unavailable");
  assert.equal(okFetch.urls.length, 0);

  // Just past 5 minutes the cache expires and the next fetch succeeds.
  clock += 4 * 60 * 1000 + 1;
  const refreshed = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: okFetch.fetchImpl,
    now,
  });
  assert.equal(refreshed.status, "ok");
  assert.equal(okFetch.urls.length, 1);
});

test("a caller-aborted request is not cached and does not retry", async () => {
  __clearTreasuryYieldCurveCacheForTests();
  const controller = new AbortController();
  controller.abort();
  const urls: string[] = [];
  const abortingFetch = (async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    init?.signal?.throwIfAborted();
    return xmlResponse(OK_XML);
  }) as unknown as typeof fetch;

  const aborted = await fetchTreasuryYieldCurveRates({
    asOf: new Date(Date.UTC(2026, 5, 15)),
    fetchImpl: abortingFetch,
    signal: controller.signal,
  });
  assert.equal(aborted.status, "unavailable");
  // No prior-month retry against an already-aborted caller signal.
  assert.equal(urls.length, 1);

  // The abort must not poison the shared cache: the next caller fetches fresh.
  const okFetch = sequencedFetch([xmlResponse(OK_XML)]);
  const next = await fetchTreasuryYieldCurveRates({
    asOf: new Date(Date.UTC(2026, 5, 15)),
    fetchImpl: okFetch.fetchImpl,
  });
  assert.equal(next.status, "ok");
  assert.equal(okFetch.urls.length, 1);
});

test("ok results stay cached for the long TTL", async () => {
  __clearTreasuryYieldCurveCacheForTests();
  let clock = 1_000_000;
  const now = () => clock;
  const asOf = new Date(Date.UTC(2026, 5, 15));

  const okFetch = sequencedFetch([xmlResponse(OK_XML)]);
  const first = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: okFetch.fetchImpl,
    now,
  });
  assert.equal(first.status, "ok");
  assert.equal(okFetch.urls.length, 1);

  // Well past the unavailable TTL but within 6h: still served from cache.
  clock += 60 * 60 * 1000;
  const cached = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: okFetch.fetchImpl,
    now,
  });
  assert.equal(cached.status, "ok");
  assert.equal(okFetch.urls.length, 1);

  // Past 6h the cache expires and a refetch happens.
  clock += 5 * 60 * 60 * 1000 + 1;
  const secondFetch = sequencedFetch([xmlResponse(OK_XML)]);
  const refreshed = await fetchTreasuryYieldCurveRates({
    asOf,
    fetchImpl: secondFetch.fetchImpl,
    now,
  });
  assert.equal(refreshed.status, "ok");
  assert.equal(secondFetch.urls.length, 1);
});
