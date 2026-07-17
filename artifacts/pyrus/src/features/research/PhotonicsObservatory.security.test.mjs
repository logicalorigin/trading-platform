import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./PhotonicsObservatory.jsx", import.meta.url),
  "utf8",
);

test("research graph tooltip never interprets dataset fields as HTML", () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=/);
  assert.doesNotMatch(source, /\.html\s*\(/);
});
