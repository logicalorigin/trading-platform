import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./ContractDetailInline.jsx", import.meta.url),
  "utf8",
);

test("flow contract detail does not claim that an unpersisted alert was created", () => {
  assert.doesNotMatch(source, /\balertSet\b|\bsetAlertSet\b/);
  assert.doesNotMatch(source, /Alert set|Alert active|Notify on next big activity/);
  assert.match(source, /data-testid="flow-contract-alert-unavailable"/);
  assert.match(source, /Flow contract alerts are not available yet\./);
  assert.match(source, />\s*Alerts unavailable\s*<\/button>/);

  const marker = source.indexOf('data-testid="flow-contract-alert-unavailable"');
  const button = source.slice(
    source.lastIndexOf("<button", marker),
    source.indexOf("</button>", marker),
  );
  assert.match(button, /\bdisabled\b/);
  assert.doesNotMatch(button, /\bonClick=/);
});
