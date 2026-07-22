import assert from "node:assert/strict";
import test from "node:test";

import { COMPANIES } from "./researchCompanies.js";
import { EDGES } from "./researchGraph.js";

test("research graph edges are unique and reference covered companies", () => {
  const companyTickers = new Set(COMPANIES.map((company) => company.t));
  const edgeKeys = EDGES.map((edge) => JSON.stringify(edge));

  assert.equal(new Set(edgeKeys).size, edgeKeys.length);
  EDGES.forEach(([source, target]) => {
    assert.equal(companyTickers.has(source), true, `missing source company: ${source}`);
    assert.equal(companyTickers.has(target), true, `missing target company: ${target}`);
  });
});
