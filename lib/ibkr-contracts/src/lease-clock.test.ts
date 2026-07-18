import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLinuxBoottimeNs,
  readLinuxBoottimeNs,
} from "./lease-clock";

test("parses the suspend-aware Linux uptime clock without floating point", () => {
  assert.equal(parseLinuxBoottimeNs("123.45 67.89\n"), 123_450_000_000n);
  assert.equal(parseLinuxBoottimeNs("0.000000001 0.00\n"), 1n);
  assert.equal(parseLinuxBoottimeNs("7 3\n"), 7_000_000_000n);
  assert.ok(readLinuxBoottimeNs() > 0n);
});

test("rejects malformed or overflowing Linux uptime clocks", () => {
  for (const value of [
    "",
    "-1.00 0.00\n",
    "1.0000000000 0.00\n",
    "1e3 0.00\n",
    "9223372037 0.00\n",
  ]) {
    assert.throws(() => parseLinuxBoottimeNs(value));
  }
});
