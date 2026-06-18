import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ACCOUNT_VALUE_MASK,
  formatAccountPrice,
  formatMoney,
  formatNumber,
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
