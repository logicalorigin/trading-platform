import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readLocalSource = (filename) =>
  readFileSync(new URL(filename, import.meta.url), "utf8");

test("timeframe favorite persistence leaves workspace event dispatch to persistState", () => {
  const favoritesSource = readLocalSource("./useChartTimeframeFavorites.js");
  const workspaceStateSource = readLocalSource("../../lib/workspaceState.js");

  assert.doesNotMatch(favoritesSource, /window\.dispatchEvent/);
  assert.doesNotMatch(
    favoritesSource,
    /setFavoriteTimeframes\(\(current\) => \{[\s\S]*?persistState/,
  );
  assert.match(
    favoritesSource,
    /readPersistedState\(\)\.chartTimeframeFavorites/,
  );
  assert.match(
    workspaceStateSource,
    /export const persistState[\s\S]*window\.dispatchEvent/,
  );
});
