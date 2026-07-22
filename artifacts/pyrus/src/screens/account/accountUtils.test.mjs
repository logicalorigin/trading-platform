import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNT_VALUE_MASK,
  formatAccountPrice,
  formatMoney,
  formatNumber,
  formatPercent,
  formatSignedMoney,
  toneForValue,
} from "./accountUtils.jsx";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("account numeric formatters keep existing display semantics", () => {
  assert.equal(
    formatAccountPrice(1234.5, 2),
    new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(1234.5),
  );
  assert.equal(
    formatNumber(1234.567, 2),
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(1234.567),
  );
  assert.equal(formatMoney(1234.5, "USD", true), "$1.2K");
  assert.equal(formatAccountPrice(1234.5, 2, true), ACCOUNT_VALUE_MASK);
});

test("account numeric formatters never coerce missing text to zero", () => {
  for (const missing of [null, undefined, "", "   ", "not-a-number"]) {
    assert.equal(formatMoney(missing), "—");
    assert.equal(formatNumber(missing), "—");
    assert.equal(formatAccountPrice(missing), "—");
    assert.equal(formatPercent(missing), "—");
    assert.equal(formatSignedMoney(missing), "—");
    assert.equal(toneForValue(missing), "var(--ra-pnl-neutral)");
  }
});

test("money formatters withhold values without a valid currency authority", () => {
  for (const currency of [null, "", "US", "not-money"]) {
    assert.equal(formatMoney(100, currency), "—");
    assert.equal(formatSignedMoney(100, currency), "—");
  }
  assert.equal(formatMoney(100, "cad"), "CAD 100");
});

test("account panels expose their title as an accessible section name", () => {
  const accountUtilsSource = readLocalSource("./accountUtils.jsx");

  assert.match(accountUtilsSource, /<section\s+aria-label=\{title\}/);
});

test("account collapsible storage uses the current prefix once", () => {
  const accountUtilsSource = readLocalSource("./accountUtils.jsx");

  assert.doesNotMatch(
    accountUtilsSource,
    /LEGACY_COLLAPSIBLE_STORAGE_PREFIX/,
    "Expected account collapsible storage to avoid same-value legacy prefixes",
  );
  assert.equal(
    accountUtilsSource.match(/window\.localStorage\.getItem/g)?.length,
    1,
    "Expected account collapsible storage to read the current key directly",
  );
});

test("account range helpers stay owned by accountRanges", () => {
  const accountUtilsSource = readLocalSource("./accountUtils.jsx");

  assert.doesNotMatch(
    accountUtilsSource,
    /export\s*\{\s*ACCOUNT_RANGES,\s*normalizeAccountRange\s*\}\s*from\s*["']\.\/accountRanges["']/,
    "Expected accountUtils to avoid re-exporting account range helpers",
  );
});
