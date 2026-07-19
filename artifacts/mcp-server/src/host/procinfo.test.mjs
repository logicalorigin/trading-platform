import assert from "node:assert/strict";
import test from "node:test";

import { __procinfoInternalsForTests } from "./procinfo.ts";

const { parseListeningPorts } = __procinfoInternalsForTests;

test("procinfo exposes only live port parsing internals", () => {
  assert.deepEqual(Object.keys(__procinfoInternalsForTests), [
    "parseListeningPorts",
  ]);
});

test("parseListeningPorts extracts LISTEN (0A) ports and ignores others", () => {
  // sl  local_address rem_address st ...  ; st 0A = LISTEN, 01 = ESTABLISHED.
  const content = [
    "  sl  local_address rem_address   st",
    "   0: 0100007F:1F90 00000000:0000 0A 00000000",
    "   1: 0100007F:493B 00000000:0000 0A 00000000",
    "   2: 0100007F:1F90 0100007F:C001 01 00000000",
  ].join("\n");
  const ports = parseListeningPorts(content);
  assert.ok(ports.includes(0x1f90), "8080 (0x1F90) listening");
  assert.ok(ports.includes(0x493b), "18747 (0x493B) listening");
  assert.equal(ports.filter((p) => p === 0x1f90).length, 1, "established row not double-counted as listen");
  assert.equal(0x1f90, 8080);
  assert.equal(0x493b, 18747);
});
