import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("runtime pressure diagnostics never reuse a prior query after failure", () => {
  const source = readFileSync(
    new URL("./useRuntimeControlSnapshot.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /placeholderData/);
  assert.match(
    source,
    /runtimeDiagnostics \|\|\s*\(runtimeDiagnosticsQuery\.isError\s*\? null\s*:\s*runtimeDiagnosticsQuery\.data\) \|\|\s*null/,
  );
});
