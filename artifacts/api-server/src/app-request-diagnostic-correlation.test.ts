import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./app.ts", import.meta.url), "utf8");

test("request diagnostics retain pino numeric and string request IDs", () => {
  assert.match(
    source,
    /typeof requestId === "string" \|\| typeof requestId === "number"/,
  );
  assert.match(source, /requestId:\s*requestDiagnosticId\(requestId\)/);
});
