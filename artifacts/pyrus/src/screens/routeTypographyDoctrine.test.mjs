import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("GEX table headers stay prose while numeric cells use the data face", () => {
  const source = read("./GexScreen.jsx");
  const header = source.match(/const tableHeaderStyle = \{[\s\S]*?\n\};/);
  const cell = source.match(/const tableCellStyle = \{[\s\S]*?\n\};/);

  assert.ok(header, "expected GEX table header style");
  assert.ok(cell, "expected GEX table cell style");
  assert.match(header[0], /fontFamily: T\.sans/);
  assert.match(cell[0], /fontFamily: T\.data/);
});

test("Diagnostics labels stay prose while JSON and machine values use the data face", () => {
  const source = read("./DiagnosticsScreen.jsx");
  const jsonBlock = source.match(/const JsonBlock = \([\s\S]*?\n\);/);
  const stateRow = source.match(/const StateRow = \([\s\S]*?\n\);/);

  assert.ok(jsonBlock, "expected Diagnostics JSON block");
  assert.ok(stateRow, "expected Diagnostics state row");
  assert.match(jsonBlock[0], /fontFamily: T\.data/);
  assert.match(stateRow[0], /fontFamily: T\.sans/);
  assert.match(stateRow[0], /<span[\s\S]*?fontFamily: T\.data/);
});

test("Trade ticket number inputs consistently use the data face", () => {
  const source = read("../features/trade/TradeOrderTicket.jsx");
  const numberInputs = [...source.matchAll(/<input\b[\s\S]*?\/>/g)]
    .map((match) => match[0])
    .filter((input) => /type="number"/.test(input));

  assert.ok(numberInputs.length > 0, "expected Trade ticket number inputs");
  for (const input of numberInputs) {
    assert.match(input, /fontFamily: T\.data/, input.slice(0, 180));
  }
});
