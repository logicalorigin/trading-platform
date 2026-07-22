import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PositionsPanel.jsx", import.meta.url), "utf8");

test("stacked position ratios use the canonical data font on both value lines", () => {
  const subTextStyle = source.match(
    /const denseColumnSubTextStyle = \(\{[\s\S]*?\n\}\);/,
  )?.[0];
  const stackedValue = source.match(
    /const DenseStackedValue = \(\{[\s\S]*?\n\);/,
  )?.[0];

  assert.ok(subTextStyle, "Missing dense secondary-value style");
  assert.ok(stackedValue, "Missing DenseStackedValue");
  assert.match(subTextStyle, /fontFamily = T\.data/);
  assert.match(stackedValue, /primaryFontFamily = T\.data/);
  assert.match(stackedValue, /secondaryFontFamily = T\.data/);
  assert.match(stackedValue, /fontFamily: primaryFontFamily/);
  assert.match(stackedValue, /fontFamily: secondaryFontFamily/);
});

test("text-only Cash and Total summary rows opt back into the interface font", () => {
  const cashRowStart = source.indexOf('primary="Cash"');
  const totalRowStart = source.indexOf('primary="Total"');
  const cashRow = source.slice(cashRowStart, cashRowStart + 420);
  const totalRow = source.slice(totalRowStart, totalRowStart + 520);

  assert.notEqual(cashRowStart, -1, "Missing Cash summary row");
  assert.notEqual(totalRowStart, -1, "Missing Total summary row");
  assert.match(cashRow, /primaryFontFamily=\{T\.sans\}/);
  assert.match(cashRow, /secondaryFontFamily=\{T\.sans\}/);
  assert.match(totalRow, /primaryFontFamily=\{T\.sans\}/);
  assert.match(totalRow, /secondaryFontFamily=\{T\.sans\}/);
});

test("compact option contracts opt into the data subtext role", () => {
  const contractDetailStart = source.indexOf("compactPositionContractDetail(row) ?");
  const contractDetail = source.slice(contractDetailStart, contractDetailStart + 320);

  assert.notEqual(contractDetailStart, -1, "Missing compact option-contract detail");
  assert.match(contractDetail, /cellSubTextStyle\(CSS_COLOR\.textDim, "data"\)/);
});
