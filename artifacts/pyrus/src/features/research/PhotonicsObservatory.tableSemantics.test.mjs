import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const observatorySource = readFileSync(
  new URL("./PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);

test("research tables preserve row semantics and use native selection controls", () => {
  const sourceWithoutArrowTokens = observatorySource.replaceAll("=>", "ARROW");
  assert.equal(
    /<tr\b[^>]*\brole=(?:["']button["']|\{[^}]*["']button["'][^}]*\})/s.test(
      sourceWithoutArrowTokens,
    ),
    false,
    "table rows must retain native row semantics",
  );
  assert.match(
    observatorySource,
    /data-testid=\{`research-peer-\$\{r\.ticker\}`\}/,
  );
  assert.match(
    observatorySource,
    /data-testid=\{`research-company-\$\{c\.t\}`\}/,
  );
  assert.match(
    observatorySource,
    /data-testid=\{`research-peer-grid-\$\{c\.t\}`\}/,
  );
  assert.doesNotMatch(
    observatorySource,
    /<tr[\s\S]{0,180}?onClick=\{row\.expandable/,
  );
  assert.match(
    observatorySource,
    /data-testid=\{`research-financial-toggle-\$\{row\.k\}`\}[\s\S]{0,180}?aria-expanded=\{expanded\.has\(row\.k\)\}/,
  );
});

test("research comparison labels use text and semantic markers instead of emoji decoration", () => {
  assert.match(observatorySource, /\{ k: "cc", l: "Country"/);
  assert.doesNotMatch(
    observatorySource,
    /\\u\{1F30D\}|\\u\{1F7E2\}|\\u\{1F534\}/,
  );
  assert.match(observatorySource, />profitable<\/span>/);
  assert.match(observatorySource, />unprofitable<\/span>/);
});

test("research comparison table is named and keyboard-scrollable", () => {
  assert.match(
    observatorySource,
    /data-testid="research-company-table-scroll"[\s\S]{0,220}?role="region"[\s\S]{0,220}?tabIndex=\{0\}/,
  );
  assert.match(
    observatorySource,
    /<table[\s\S]{0,160}?aria-label="Research company comparison"/,
  );
});
