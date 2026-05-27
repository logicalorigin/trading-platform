import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("pine script responses normalize retired algo branding and hide duplicate legacy seeds", () => {
  const source = readFileSync(new URL("./pine-scripts.ts", import.meta.url), "utf8");

  assert.match(source, /normalizeLegacyAlgoBrandText/);
  assert.match(source, /normalizeLegacyAlgoBranding/);
  assert.match(source, /function filterLegacyPineScriptDuplicates/);
  assert.match(source, /filterLegacyPineScriptDuplicates\(scripts\)\.map/);
  assert.match(
    source,
    /scriptKey:\s*normalizeLegacyAlgoBrandText\(script\.scriptKey\)/,
  );
  assert.match(source, /sourceCode:\s*normalizeLegacyAlgoBrandText\(script\.sourceCode\)/);
});
