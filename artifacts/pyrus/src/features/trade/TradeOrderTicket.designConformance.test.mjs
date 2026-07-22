import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TradeOrderTicket.jsx", import.meta.url),
  "utf8",
);

const indexOfMarker = (marker) => {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Expected ${marker}`);
  return index;
};

test("Trade ticket sections follow the operator decision order", () => {
  const sectionMarkers = [
    'testId="trade-ticket-route-section"',
    'testId="trade-ticket-asset-section"',
    'testId="trade-ticket-order-section"',
    'testId="trade-ticket-estimate-section"',
    'testId="trade-ticket-review-section"',
  ];
  const indexes = sectionMarkers.map(indexOfMarker);

  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
  assert.match(source, /import \{ SectionHeader \}/);
});

test("Trade order controls scan side, quantity, type, then price", () => {
  const controlMarkers = [
    'data-testid="trade-ticket-side-controls"',
    'data-testid="trade-ticket-quantity-controls"',
    'data-testid="trade-ticket-order-type-controls"',
    'data-testid="trade-ticket-price-controls"',
  ];
  const indexes = controlMarkers.map(indexOfMarker);

  assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
});

test("Trade ticket critical phone actions use explicit buttons and the touch floor", () => {
  for (const testId of [
    "trade-ticket-close-review-exit",
    "trade-ticket-preview-action",
    "trade-ticket-submit-action",
  ]) {
    const marker = `data-testid="${testId}"`;
    const markerIndex = indexOfMarker(marker);
    const buttonStart = source.lastIndexOf("<button", markerIndex);
    const buttonEnd = source.indexOf(">", markerIndex);
    const buttonSource = source.slice(buttonStart, buttonEnd + 1);

    assert.match(buttonSource, /type="button"/, `${testId} needs button type`);
    assert.match(
      buttonSource,
      /className="ra-touch-target-y"/,
      `${testId} needs the shared touch floor`,
    );
  }
});

test("Trade ticket estimates use canonical contract economics", () => {
  assert.match(source, /multiplier=\{ticketMultiplier\}/);
  assert.match(source, /side=\{optionOrderIntent\?\.positionSide\}/);
  assert.doesNotMatch(source, /\bconst pop\b|\bPOP\b/);
  assert.match(source, /title: "Contract economics unavailable"/);
  assert.doesNotMatch(
    source,
    /averageFillPrice \|\| 0|fillPrice \|\| 0|previewPrice \* qtyNum \* 100/,
  );
});
