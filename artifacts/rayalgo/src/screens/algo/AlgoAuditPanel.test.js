import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./AlgoAuditPanel.jsx", import.meta.url), "utf8");

test("algo audit panel paginates filtered execution events", () => {
  assert.match(source, /AUDIT_PAGE_SIZE = 50/);
  assert.match(source, /paginateRows\(filteredEvents,\s*page,\s*AUDIT_PAGE_SIZE\)/);
  assert.match(source, /pageEvents\.map/);
  assert.match(source, /dataTestId="algo-audit-pagination"/);
});
