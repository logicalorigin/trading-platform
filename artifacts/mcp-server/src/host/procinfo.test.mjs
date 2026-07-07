import assert from "node:assert/strict";
import test from "node:test";

import { __procinfoInternalsForTests } from "./procinfo.ts";

const { parsePpidFromStat, parseListeningPorts, cmdlineIsPid2 } = __procinfoInternalsForTests;

test("cmdlineIsPid2 matches the pooled-microVM pid2 server by argv0, not comm", () => {
  // Observed live on cluster riker (pid 23, comm "node"):
  assert.equal(
    cmdlineIsPid2(
      "pid2\0--no-deprecation\0--disable-warning=ExperimentalWarning\0--use-openssl-ca\0/mnt/pid2/server.cjs\0--pooled-fd=4\0",
    ),
    true,
  );
  // argv0 may also be an absolute path.
  assert.equal(cmdlineIsPid2("/usr/bin/pid2\0--flag\0"), true);
  // Mentioning pid2 elsewhere in argv must NOT match.
  assert.equal(cmdlineIsPid2("node\0/mnt/pid2/server.cjs\0"), false);
  assert.equal(cmdlineIsPid2("node\0./scripts/runDevApp.mjs\0"), false);
  assert.equal(cmdlineIsPid2(""), false);
});

test("parsePpidFromStat reads ppid past a comm containing spaces and parens", () => {
  // ppid is the 4th field overall, i.e. the 2nd after the final ')'.
  assert.equal(parsePpidFromStat("123052 (node (weird) ) S 123030 49057 13 1"), 123030);
  assert.equal(parsePpidFromStat("13 (init) S 1 0 1"), 1);
  assert.equal(parsePpidFromStat("garbage"), null);
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
