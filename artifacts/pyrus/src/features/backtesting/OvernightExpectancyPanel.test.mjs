import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./OvernightExpectancyPanel.tsx", import.meta.url),
  "utf8",
);

test("overnight expectancy queries normalize native transport failures", () => {
  assert.match(
    source,
    /import \{ fetchWithNetworkError \} from "\.\.\/platform\/fetchWithNetworkError\.js";/,
  );
  assert.match(source, /const response = await fetchWithNetworkError\(url, \{/);
});
