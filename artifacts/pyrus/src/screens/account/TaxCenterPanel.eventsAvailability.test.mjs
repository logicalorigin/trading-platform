import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TaxCenterPanel.jsx", import.meta.url),
  "utf8",
);

test("Tax Center owns a single events-query attempt and distinguishes snapshot presence", () => {
  assert.match(
    source,
    /useGetAccountTaxEvents\(accountId, \{[\s\S]*?query: \{ enabled: Boolean\(accountId\) && activeTab === "Overview", retry: false \},[\s\S]*?\}\);/,
  );
  assert.match(
    source,
    /const hasEventsSnapshot = eventsQuery\.data !== undefined;/,
  );
  assert.match(
    source,
    /const eventCount = asArray\(eventsQuery\.data\?\.events\)\.length;/,
  );
});

test("Tax Center renders truthful accessible event availability states", () => {
  assert.match(source, /role="status"[\s\S]*?Loading tax events/);
  assert.match(source, /Events loaded: \{eventCount\}/);
  assert.match(
    source,
    /role="status"[\s\S]*?Events loaded: \{eventCount\} \(last known\)\. Latest refresh unavailable\./,
  );
  assert.match(
    source,
    /role="alert"[\s\S]*?Tax events temporarily unavailable\./,
  );
  assert.doesNotMatch(
    source,
    /Events loaded: \{asArray\(eventsQuery\.data\?\.events\)\.length\}/,
  );
});

test("Tax Center memo tracks every event availability input", () => {
  assert.match(
    source,
    /eventCount,[\s\S]*?eventsQuery\.error,[\s\S]*?eventsQuery\.isLoading,[\s\S]*?hasEventsSnapshot,/,
  );
});

test("Tax Center leaves missing financial estimates unavailable", () => {
  assert.match(source, /const numberOrNull = \(value\) =>/);
  assert.doesNotMatch(source, /numberOrZero/);
  assert.doesNotMatch(source, /reserve\.targetAmount \|\| 0/);
  assert.doesNotMatch(source, /reserve\.reservedAmount \|\| 0/);
  assert.doesNotMatch(source, /estimates\.totalReserveTarget \|\| 0/);
  assert.match(
    source,
    /shadowFederalEstimate != null && shadowStateEstimate != null/,
  );
});

test("Tax Center child tabs expose pending and failed query states", () => {
  assert.match(source, /const activeDetailQuery =/);
  assert.match(source, /activeDetailQuery\.data === undefined/);
  assert.match(source, /Loading \{activeTab\}/);
  assert.match(source, /\{activeTab\} temporarily unavailable\./);
  assert.match(
    source,
    /useGetTaxReserve\(\{[\s\S]*?enabled: activeTab === "Reserve"/,
  );
  assert.doesNotMatch(source, /if \(overviewQuery\.isLoading\)/);
});
