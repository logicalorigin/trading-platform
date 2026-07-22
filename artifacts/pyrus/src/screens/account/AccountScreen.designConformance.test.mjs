import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appStyles = readFileSync(
  new URL("../../index.css", import.meta.url),
  "utf8",
);

test("account card spans follow measured workspace layout instead of viewport width", () => {
  assert.match(
    appStyles,
    /\[data-testid="account-screen"\]\[data-layout="tablet"\][\s\S]*?\.ra-account-overview-grid[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
  );
  assert.match(
    appStyles,
    /\[data-testid="account-screen"\]\[data-layout="tablet"\] \.ra-account-overview-equity[\s\S]*?grid-column:\s*1\s*\/\s*-1/,
  );
  assert.doesNotMatch(
    appStyles,
    /@media \(max-width: 1420px\)[\s\S]{0,320}\.ra-account-overview-grid/,
  );
});

test("account overview cards stack to one track on phone", () => {
  assert.match(
    appStyles,
    /\[data-testid="account-screen"\] \.ra-account-overview-grid \{\s*grid-template-columns:\s*minmax\(0,\s*1fr\) !important;/,
  );
});
