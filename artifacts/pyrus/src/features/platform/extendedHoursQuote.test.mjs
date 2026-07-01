import assert from "node:assert/strict";
import test from "node:test";

import { resolveExtendedHoursQuoteDisplay } from "./extendedHoursQuote.ts";

test("shows pre-market move against verified regular close baseline", () => {
  const display = resolveExtendedHoursQuoteDisplay({
    quote: {
      price: 101.5,
      extendedBaselinePrice: 100,
      extendedBaselineSource: "regular_close",
      dataUpdatedAt: "2026-06-09T12:00:00.000Z",
    },
  });

  assert.equal(display?.sessionLabel, "Pre");
  assert.equal(display?.axisLabel, "PRE");
  assert.equal(display?.change, 1.5);
  assert.equal(display?.changePercent, 1.5);
});

test("shows after-hours move against same-day regular close baseline", () => {
  const display = resolveExtendedHoursQuoteDisplay({
    quote: {
      price: 98,
      extendedBaselinePrice: 100,
      extendedBaselineSource: "regular_close",
      dataUpdatedAt: "2026-06-09T21:00:00.000Z",
      delayed: true,
    },
  });

  assert.equal(display?.sessionLabel, "After");
  assert.equal(display?.axisLabel, "AFT");
  assert.equal(display?.tone, "negative");
  assert.equal(display?.delayed, true);
});

test("shows overnight move against most recent regular close baseline", () => {
  const display = resolveExtendedHoursQuoteDisplay({
    quote: {
      price: 101,
      extendedBaselinePrice: 100,
      extendedBaselineSource: "regular_close",
      // 2026-06-10T01:00Z = Tue 2026-06-09 21:00 ET, inside the 20:00–03:50 ET
      // overnight session.
      dataUpdatedAt: "2026-06-10T01:00:00.000Z",
    },
  });

  assert.equal(display?.sessionLabel, "Overnight");
  assert.equal(display?.axisLabel, "OVN");
  assert.equal(display?.change, 1);
  assert.equal(display?.tone, "positive");
});

test("labels by wall-clock session when a now is supplied", () => {
  const display = resolveExtendedHoursQuoteDisplay({
    quote: {
      price: 101,
      extendedBaselinePrice: 100,
      extendedBaselineSource: "regular_close",
      // Frozen after-hours tick (Tue 17:00 ET)...
      dataUpdatedAt: "2026-06-09T21:00:00.000Z",
    },
    // ...viewed during overnight (Tue 21:00 ET) is labeled Overnight, not After.
    now: "2026-06-10T01:00:00.000Z",
  });

  assert.equal(display?.sessionLabel, "Overnight");
  assert.equal(display?.axisLabel, "OVN");
});

test("hides during regular, closed, or unverified baseline states", () => {
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: 100,
        extendedBaselineSource: "regular_close",
        dataUpdatedAt: "2026-06-09T14:00:00.000Z",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: 100,
        extendedBaselineSource: "regular_close",
        // 2026-06-13T16:00Z = Sat 12:00 ET, market closed (weekend).
        dataUpdatedAt: "2026-06-13T16:00:00.000Z",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: null,
        extendedBaselineSource: "regular_close",
        dataUpdatedAt: "2026-06-09T21:00:00.000Z",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: 100,
        extendedBaselineSource: null,
        dataUpdatedAt: "2026-06-09T21:00:00.000Z",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: 100,
        extendedBaselineSource: "regular_close",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 0,
        extendedBaselinePrice: 100,
        extendedBaselineSource: "regular_close",
        dataUpdatedAt: "2026-06-09T21:00:00.000Z",
      },
    }),
    null,
  );
  assert.equal(
    resolveExtendedHoursQuoteDisplay({
      quote: {
        price: 101,
        extendedBaselinePrice: 0,
        extendedBaselineSource: "regular_close",
        dataUpdatedAt: "2026-06-09T21:00:00.000Z",
      },
    }),
    null,
  );
});
