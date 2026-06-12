import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./PositionProtectionEditor.jsx", import.meta.url), "utf8");

test("protective stop editor blocks wrong-side live stop submissions", () => {
  assert.match(
    source,
    /A protective stop must sit on the loss side of the mark: below for longs,[\s\S]*hard-block/,
  );
  assert.match(source, /const submitDisabled = pending \|\| !canSubmit \|\| !stopValid \|\| wrongSide;/);
  assert.match(
    source,
    /Stop must be below mark for a long and above mark for a short\./,
  );
});
