import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGexHeatmapCellTitle,
  buildGexHeatmapModel,
  formatHeatmapExpirationDte,
  formatHeatmapExpirationLabel,
  formatHeatmapCellValue,
  formatHeatmapStrikeLabel,
  getGexHeatmapCellStats,
  getGexHeatmapCellValue,
  hasGexHeatmapCellValue,
} from "./gexHeatmapModel.js";

const row = (overrides = {}) => ({
  expirationDate: "2026-05-15",
  strike: 100,
  cp: "C",
  gamma: 0.02,
  openInterest: 10,
  multiplier: 100,
  ...overrides,
});

test("GEX heatmap model aggregates cells with contract GEX and same-year expiration labels", () => {
  const model = buildGexHeatmapModel(
    [
      row(),
      row({ strike: 105, expirationDate: "2026-05-22", gamma: 0.01 }),
    ],
    100,
    new Date("2026-05-14T12:00:00.000Z"),
  );

  assert.deepEqual(
    model.expirations.map((expiration) => expiration.label),
    ["May 15", "May 22"],
  );
  assert.deepEqual(
    model.expirations.map((expiration) => expiration.dteLabel),
    ["1d", "8d"],
  );
  assert.equal(model.expirations[0].iso, "2026-05-15T00:00:00.000Z");
  assert.deepEqual(model.strikes, [100, 105]);
  assert.equal(getGexHeatmapCellValue(model, 100, "2026-05-15"), 2_000);
  assert.equal(getGexHeatmapCellValue(model, 100, "2026-05-22"), 0);
  assert.equal(hasGexHeatmapCellValue(model, 100, "2026-05-22"), false);
});

test("GEX heatmap cells keep per-expiration signed values for color", () => {
  const model = buildGexHeatmapModel(
    [
      row({ strike: 100, expirationDate: "2026-05-15", gamma: 0.02 }),
      row({ strike: 100, expirationDate: "2026-05-22", gamma: 0.2 }),
      row({ strike: 105, expirationDate: "2026-05-22", cp: "P", gamma: 0.5 }),
    ],
    100,
  );

  assert.equal(model.firstExpirationKey, "2026-05-15");
  assert.equal(model.maxAbs, 50_000);
  assert.equal(getGexHeatmapCellValue(model, 100, "2026-05-15"), 2_000);
  assert.equal(getGexHeatmapCellValue(model, 100, "2026-05-22"), 20_000);
  assert.equal(getGexHeatmapCellValue(model, 105, "2026-05-22"), -50_000);
  assert.equal(hasGexHeatmapCellValue(model, 105, "2026-05-15"), false);
});

test("GEX heatmap labels match InsiderFinance-style month-day headers", () => {
  const model = buildGexHeatmapModel(
    [
      row({ expirationDate: "2026-12-18" }),
      row({ expirationDate: "2027-01-15" }),
    ],
    100,
    new Date("2026-12-17T12:00:00.000Z"),
  );

  assert.deepEqual(
    model.expirations.map((expiration) => expiration.label),
    ["Dec 18", "Jan 15"],
  );
  assert.deepEqual(
    model.expirations.map((expiration) => expiration.dteLabel),
    ["1d", "29d"],
  );
});

test("GEX heatmap cells render InsiderFinance-style compact currency labels", () => {
  assert.equal(formatHeatmapCellValue(0), "$0.0");
  assert.equal(formatHeatmapCellValue(500), "$500.0");
  assert.equal(formatHeatmapCellValue(-500), "-$500.0");
  assert.equal(formatHeatmapCellValue(2_000), "$2.0K");
  assert.equal(formatHeatmapCellValue(858_300), "$858.3K");
  assert.equal(formatHeatmapCellValue(-1_500_000), "-$1.5M");
  assert.equal(formatHeatmapCellValue(3_900_000_000), "$3.9B");
});

test("GEX heatmap strike labels keep fractional strikes distinct", () => {
  assert.equal(formatHeatmapStrikeLabel(762.5), "$762.50");
  assert.equal(formatHeatmapStrikeLabel(763), "$763");
  assert.equal(formatHeatmapStrikeLabel(9.5), "$9.50");
});

test("GEX heatmap expiration formatters expose date and DTE labels", () => {
  assert.equal(formatHeatmapExpirationLabel("2026-06-01"), "Jun 1");
  assert.equal(
    formatHeatmapExpirationDte(
      "2026-06-01",
      new Date("2026-05-31T15:00:00.000Z"),
    ),
    "1d",
  );
});

test("GEX heatmap DTE uses the New York market day near UTC midnight", () => {
  assert.equal(
    formatHeatmapExpirationDte(
      "2026-06-01",
      new Date("2026-06-01T01:00:00.000Z"),
    ),
    "1d",
  );

  const model = buildGexHeatmapModel(
    [row({ expirationDate: "2026-06-01" })],
    100,
    new Date("2026-06-01T14:00:00.000Z"),
  );

  assert.equal(model.expirations[0].label, "0DTE");
  assert.equal(model.expirations[0].dteLabel, "today");
});

test("GEX heatmap distinguishes missing cells from real zero exposure cells", () => {
  const model = buildGexHeatmapModel(
    [
      row({ strike: 100, expirationDate: "2026-05-15", cp: "C", gamma: 0.02 }),
      row({ strike: 100, expirationDate: "2026-05-15", cp: "P", gamma: 0.02 }),
      row({ strike: 101, expirationDate: "2026-05-22", cp: "C", gamma: 0.01 }),
    ],
    100,
  );

  assert.equal(hasGexHeatmapCellValue(model, 100, "2026-05-15"), true);
  assert.equal(getGexHeatmapCellValue(model, 100, "2026-05-15"), 0);
  assert.equal(hasGexHeatmapCellValue(model, 100, "2026-05-22"), false);
});

test("GEX heatmap tooltip title uses full ISO expiration text", () => {
  const model = buildGexHeatmapModel([row(), row({ cp: "P", gamma: 0.01 })], 100);
  const expiration = model.expirations[0];
  const stats = getGexHeatmapCellStats(model, 100, "2026-05-15");

  assert.equal(
    buildGexHeatmapCellTitle({
      strike: 100,
      expiration,
      value: 1_000,
      valueLabel: "$1.0K",
      stats,
    }),
    "$100 · 2026-05-15T00:00:00.000Z · Net GEX $1.0K · Call GEX $2.0K (10 OI) · Put GEX -$1.0K (10 OI)",
  );
});
