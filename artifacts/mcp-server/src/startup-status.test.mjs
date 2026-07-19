import assert from "node:assert/strict";
import test from "node:test";

import { config } from "./config.ts";
import * as logging from "./log.ts";

test("startup status omits configuration and thrown failure details", () => {
  assert.equal(typeof logging.reportStartupReady, "function");
  assert.equal(typeof logging.reportStartupFailure, "function");

  const originalWrite = process.stderr.write;
  const marker = "synthetic-startup-secret";
  let output = "";
  process.stderr.write = (chunk) => {
    output += String(chunk);
    return true;
  };

  try {
    logging.reportStartupReady(3, 4);
    logging.reportStartupFailure(new Error(marker));
  } finally {
    process.stderr.write = originalWrite;
  }

  assert.match(output, /ready \(stdio\) — 3 http \+ 1 db \+ 4 host tools/u);
  assert.match(output, /fatal MCP startup failure/u);
  assert.doesNotMatch(output, new RegExp(marker));
  assert.equal(output.includes(config.apiBaseUrl), false);
});
