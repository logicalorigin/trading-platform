import assert from "node:assert/strict";
import test from "node:test";

import { config } from "../config.ts";
import * as resultTools from "./result.ts";

const textOf = (result) => result.content[0].text;
const { fail, fromHttpError } = resultTools;

test("failure text respects the UTF-8 response-byte cap", () => {
  const text = textOf(fail(`failure: ${"😀".repeat(config.maxResponseBytes)}`));

  assert.ok(Buffer.byteLength(text, "utf8") <= config.maxResponseBytes);
});

test("HTTP failures do not echo configured URLs or raw exception messages", () => {
  const marker = "synthetic-upstream-secret";
  const text = textOf(fromHttpError("/readiness", new Error(marker)));

  assert.doesNotMatch(text, new RegExp(marker));
  assert.equal(text.includes(config.apiBaseUrl), false);
  assert.match(text, /API unreachable/u);
});

test("host-tool failures do not echo raw exception messages", () => {
  const marker = "synthetic-host-secret";

  assert.equal(typeof resultTools.fromHostError, "function");
  const text = textOf(
    resultTools.fromHostError("get_port_bindings", new Error(marker)),
  );
  assert.doesNotMatch(text, new RegExp(marker));
});
