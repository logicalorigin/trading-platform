import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  __clearTreasuryYieldCurveCacheForTests,
  fetchTreasuryYieldCurveRates,
  parseTreasuryYieldCurveXml,
} from "./treasury-yield-curve";

afterEach(() => {
  __clearTreasuryYieldCurveCacheForTests();
});

test("parseTreasuryYieldCurveXml returns the latest usable par-yield row", () => {
  const parsed = parseTreasuryYieldCurveXml(`
    <feed>
      <entry>
        <content>
          <m:properties>
            <d:NEW_DATE>2026-05-28T00:00:00</d:NEW_DATE>
            <d:BC_1MONTH>5.21</d:BC_1MONTH>
            <d:BC_6MONTH>4.91</d:BC_6MONTH>
            <d:BC_1YEAR>4.75</d:BC_1YEAR>
          </m:properties>
        </content>
      </entry>
      <entry>
        <content>
          <m:properties>
            <d:NEW_DATE>2026-05-29T00:00:00</d:NEW_DATE>
            <d:BC_1MONTH>5.20</d:BC_1MONTH>
            <d:BC_6MONTH>4.90</d:BC_6MONTH>
            <d:BC_1YEAR>4.70</d:BC_1YEAR>
          </m:properties>
        </content>
      </entry>
    </feed>
  `);

  assert.equal(parsed.status, "ok");
  assert.equal(parsed.asOf, "2026-05-29");
  assert.deepEqual(
    parsed.points
      .slice(0, 3)
      .map((point) => ({ ...point, rate: Math.round(point.rate * 1000) / 1000 })),
    [
      { tenorYears: 1 / 12, rate: 0.052 },
      { tenorYears: 0.5, rate: 0.049 },
      { tenorYears: 1, rate: 0.047 },
    ],
  );
});

test("fetchTreasuryYieldCurveRates degrades instead of throwing", async () => {
  const rates = await fetchTreasuryYieldCurveRates({
    fetchImpl: async () => ({
      ok: false,
      status: 503,
      text: async () => "",
    } as Response),
  });

  assert.equal(rates.status, "unavailable");
  assert.equal(rates.points.length, 0);
  assert.match(rates.message ?? "", /503/);
});
