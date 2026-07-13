import assert from "node:assert/strict";
import test from "node:test";
import { withTestDb, type TestDatabase } from "@workspace/db/testing";
import { lookupHistoricalGreeks } from "./gex-historical-greeks";

const eventAt = new Date("2026-06-09T18:42:23.956Z");
const expirationDate = "2026-06-12";

async function insertSnapshot(
  client: TestDatabase["client"],
  input: { computedAt: string; options: unknown[] },
) {
  await client.query(
    `
      insert into gex_snapshots (
        symbol, computed_at, spot, net_gex, option_count,
        usable_option_count, source_status, payload
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
    [
      "AAPL",
      input.computedAt,
      200,
      0,
      input.options.length,
      input.options.length,
      "partial",
      JSON.stringify({ options: input.options }),
    ],
  );
}

test("malformed persisted strikes do not hide a valid nearby GEX match", async () => {
  await withTestDb(async ({ client }) => {
    await insertSnapshot(client, {
      computedAt: "2026-06-09T18:50:23.056Z",
      options: [
        {
          strike: "not-a-number",
          expirationDate,
          cp: "C",
          delta: 0.1,
          gamma: 0.01,
          impliedVol: 0.2,
        },
        {
          strike: 200,
          expirationDate,
          cp: "C",
          delta: 0.45,
          gamma: 0.02,
          theta: -0.1,
          vega: 0.2,
          impliedVol: 0.3,
          bid: 1,
          ask: 1.2,
        },
      ],
    });

    const result = await lookupHistoricalGreeks({
      symbol: "AAPL",
      expirationDate,
      strike: 200,
      right: "call",
      timestamp: eventAt,
    });

    assert.equal(result.source, "gex_snapshot");
    assert.equal(result.greeks.delta, 0.45);
    assert.equal(result.greeks.impliedVolatility, 0.3);
  });
});

test("missing required GEX greeks fall back instead of becoming zeroes", async () => {
  await withTestDb(async ({ client }) => {
    await insertSnapshot(client, {
      computedAt: "2026-06-09T18:50:23.056Z",
      options: [
        {
          strike: 205,
          expirationDate,
          cp: "C",
          delta: null,
          gamma: null,
          impliedVol: 0.3,
        },
      ],
    });

    const result = await lookupHistoricalGreeks({
      symbol: "AAPL",
      expirationDate,
      strike: 205,
      right: "call",
      timestamp: eventAt,
    });

    assert.equal(result.source, "bs_reconstruction");
    assert.equal(result.reason, "invalid_gex_greeks");
  });
});

test("missing theta or vega falls back instead of fabricating zeroes", async () => {
  await withTestDb(async ({ client }) => {
    await insertSnapshot(client, {
      computedAt: "2026-06-09T18:50:23.056Z",
      options: [
        {
          strike: 207.5,
          expirationDate,
          cp: "C",
          delta: 0.4,
          gamma: 0.02,
          theta: null,
          vega: 0.2,
          impliedVol: 0.3,
        },
        {
          strike: 208,
          expirationDate,
          cp: "C",
          delta: 0.4,
          gamma: 0.02,
          theta: -0.1,
          vega: null,
          impliedVol: 0.3,
        },
      ],
    });

    for (const strike of [207.5, 208]) {
      const result = await lookupHistoricalGreeks({
        symbol: "AAPL",
        expirationDate,
        strike,
        right: "call",
        timestamp: eventAt,
      });

      assert.equal(result.source, "bs_reconstruction");
      assert.equal(result.reason, "invalid_gex_greeks");
    }
  });
});

test("non-positive persisted IV falls back instead of entering Greek scoring", async () => {
  await withTestDb(async ({ client }) => {
    await insertSnapshot(client, {
      computedAt: "2026-06-09T18:50:23.056Z",
      options: [
        {
          strike: 210,
          expirationDate,
          cp: "C",
          delta: 0.4,
          gamma: 0.02,
          impliedVol: 0,
        },
      ],
    });

    const result = await lookupHistoricalGreeks({
      symbol: "AAPL",
      expirationDate,
      strike: 210,
      right: "call",
      timestamp: eventAt,
    });

    assert.equal(result.source, "bs_reconstruction");
    assert.equal(result.reason, "invalid_gex_greeks");
  });
});
