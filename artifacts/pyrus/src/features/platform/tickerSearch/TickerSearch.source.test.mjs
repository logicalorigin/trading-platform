import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./TickerSearch.jsx", import.meta.url),
  "utf8",
);

test("ticker search lab copy identifies chart search as Massive-backed", () => {
  assert.match(source, /Massive-backed chart ticker search/);
  assert.doesNotMatch(source, /Real IBKR-backed ticker search/);
});

test("shared ticker search labels Massive-backed rows consistently", () => {
  assert.match(source, /const isTickerSearchMassiveBacked = \(result\) => \{/);
  assert.match(source, /providers\.includes\("massive"\)/);
  assert.match(source, /\? "Massive"/);
  assert.doesNotMatch(source, /Massive-backed[\s\S]*Data only[\s\S]*providerLabel/);
});

test("ticker search keeps pre-debounce and placeholder rows non-selectable", () => {
  assert.match(
    source,
    /normalizeTickerSearchQuery\(query\.trim\(\)\)\s*===\s*normalizedQuery[\s\S]*!searchQuery\.isPlaceholderData/,
  );

  const selectableResultsDeclaration =
    source.match(/const selectableResults =[\s\S]*?;/)?.[0] || "";
  assert.match(selectableResultsDeclaration, /searchResultsCurrent/);
  assert.match(selectableResultsDeclaration, /\[\]/);
});

test("ticker search leaves Tab to native focus navigation", () => {
  assert.doesNotMatch(source, /event\.key === "Tab"/);
});

test("ticker search favorites use a real button outside the row button", () => {
  const rowSource = source.slice(
    source.indexOf("const TickerSearchRow"),
    source.indexOf("const TickerSearchSkeletonRows"),
  );
  const rowTestIdOffset = rowSource.indexOf('data-testid="ticker-search-row"');
  const favoriteLabelOffset = rowSource.indexOf(
    'aria-label={favorite ? "Remove from watchlist" : "Add to watchlist"}',
  );
  const rowButtonOpenOffset = rowSource.lastIndexOf("<button", rowTestIdOffset);
  const rowButtonCloseOffset = rowSource.indexOf("</button>", rowTestIdOffset);
  const favoriteButtonOpenOffset = rowSource.lastIndexOf(
    "<button",
    favoriteLabelOffset,
  );

  assert.ok(rowTestIdOffset >= 0 && favoriteLabelOffset >= 0);
  assert.ok(rowButtonOpenOffset >= 0 && rowButtonCloseOffset >= 0);
  assert.ok(
    favoriteButtonOpenOffset >= 0 &&
      (favoriteButtonOpenOffset < rowButtonOpenOffset ||
        favoriteButtonOpenOffset > rowButtonCloseOffset),
    "favorite button must be a sibling, not nested in the row button",
  );
  assert.doesNotMatch(rowSource, /<span\s+role="button"/);
});
