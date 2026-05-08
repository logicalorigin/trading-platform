import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOptionChainRowsIdentitySignature,
  buildOptionChainVirtualEntries,
  mergeVisibleOptionChainRows,
  resolveOptionChainScrollIndex,
} from "./optionChainVirtualRows.js";

const chain = [
  { k: 95 },
  { k: 100, isAtm: true },
  { k: 105 },
  { k: 110 },
];

test("resolveOptionChainScrollIndex prefers the selected strike", () => {
  assert.equal(resolveOptionChainScrollIndex(chain, 110, 100), 3);
});

test("resolveOptionChainScrollIndex falls back to the ATM strike", () => {
  assert.equal(resolveOptionChainScrollIndex(chain, 999, 100), 1);
  assert.equal(resolveOptionChainScrollIndex(chain, null, null), 1);
});

test("buildOptionChainVirtualEntries maps virtual indexes to option rows", () => {
  assert.deepEqual(
    buildOptionChainVirtualEntries(chain, [
      { index: 1, start: 24, size: 24 },
      { index: 3, start: 72, size: 24 },
      { index: 99, start: 999, size: 24 },
    ]).map(({ index, row }) => [index, row.k]),
    [
      [1, 100],
      [3, 110],
    ],
  );
});

test("mergeVisibleOptionChainRows keeps selected strike subscribed offscreen", () => {
  assert.deepEqual(
    mergeVisibleOptionChainRows([{ k: 95 }, { k: 100 }], { k: 110 }).map(
      (row) => row.k,
    ),
    [95, 100, 110],
  );
  assert.deepEqual(
    mergeVisibleOptionChainRows([{ k: 95 }, { k: 100 }], { k: 100 }).map(
      (row) => row.k,
    ),
    [95, 100],
  );
});

test("buildOptionChainRowsIdentitySignature changes when contracts change for the same strikes", () => {
  assert.notEqual(
    buildOptionChainRowsIdentitySignature([
      {
        k: 100,
        cContract: { providerContractId: "c-old" },
        pContract: { providerContractId: "p-old" },
      },
    ]),
    buildOptionChainRowsIdentitySignature([
      {
        k: 100,
        cContract: { providerContractId: "c-new" },
        pContract: { providerContractId: "p-new" },
      },
    ]),
  );
});
