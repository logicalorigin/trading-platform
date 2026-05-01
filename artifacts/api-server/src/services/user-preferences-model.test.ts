import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_USER_PREFERENCES,
  deepMergeRecords,
  normalizeUserPreferences,
} from "./user-preferences-model";

describe("user preferences model", () => {
  it("normalizes partial preference payloads with defaults", () => {
    const preferences = normalizeUserPreferences({
      time: {
        chartTimeZoneMode: "utc",
        showSeconds: true,
      },
      chart: {
        priceScaleMode: "log",
        futureExpansionBars: 12,
      },
    });

    assert.equal(preferences.time.chartTimeZoneMode, "utc");
    assert.equal(preferences.time.showSeconds, true);
    assert.equal(preferences.chart.priceScaleMode, "log");
    assert.equal(preferences.chart.futureExpansionBars, 12);
    assert.equal(preferences.appearance.theme, DEFAULT_USER_PREFERENCES.appearance.theme);
  });

  it("deep merges nested preference sections", () => {
    const merged = deepMergeRecords(DEFAULT_USER_PREFERENCES, {
      chart: {
        showGrid: false,
      },
      notifications: {
        alertVolume: 25,
      },
    });
    const preferences = normalizeUserPreferences(merged);

    assert.equal(preferences.chart.showGrid, false);
    assert.equal(preferences.chart.showVolume, true);
    assert.equal(preferences.notifications.alertVolume, 25);
  });

  it("rejects invalid strict preference values", () => {
    assert.throws(
      () =>
        normalizeUserPreferences(
          {
            time: {
              fixedTimeZone: "Not/A_Time_Zone",
            },
          },
          { strict: true },
        ),
      /Invalid user preference/,
    );

    assert.throws(
      () =>
        normalizeUserPreferences(
          {
            chart: {
              crosshairMode: "sticky",
            },
          },
          { strict: true },
        ),
      /Invalid user preference/,
    );
  });
});
