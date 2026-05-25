import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDateInputValue,
  toEndOfDayIso,
  toStartOfDayIso,
} from "./backtestingDateRanges";

const withTimeZone = (timeZone: string, assertion: () => void) => {
  const previous = process.env.TZ;
  process.env.TZ = timeZone;
  try {
    assertion();
  } finally {
    if (previous == null) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previous;
    }
  }
};

test("backtesting date inputs use local calendar days for boundaries", () => {
  withTimeZone("America/New_York", () => {
    assert.equal(toStartOfDayIso("2026-05-13"), "2026-05-13T04:00:00.000Z");
    assert.equal(toEndOfDayIso("2026-05-13"), "2026-05-14T03:59:59.999Z");
  });
});

test("backtesting date input defaults preserve the local input day", () => {
  withTimeZone("America/New_York", () => {
    assert.equal(
      formatDateInputValue(0, new Date("2026-05-14T03:30:00.000Z")),
      "2026-05-13",
    );
    assert.equal(
      formatDateInputValue(1, new Date("2026-05-14T03:30:00.000Z")),
      "2026-05-14",
    );
  });
});

test("backtesting date boundaries reject impossible calendar dates", () => {
  assert.equal(toStartOfDayIso("2026-02-31"), null);
  assert.equal(toEndOfDayIso("not-a-date"), null);
});
