import assert from "node:assert/strict";
import test from "node:test";

import { requireStandardOptionContractIdentity } from "./standard-option-contract-identity";

const standardContract = {
  contractSymbol: "O:AAPL260821C00200000",
  multiplier: 100,
  sharesPerContract: 100,
  underlyingSymbol: "AAPL",
  expiration: "2026-08-21",
  strike: 200,
  optionType: "Call" as const,
};

function expectHttpError(
  input: Parameters<typeof requireStandardOptionContractIdentity>[0],
  code: string,
) {
  assert.throws(
    () => requireStandardOptionContractIdentity(input),
    (error: unknown) => {
      const candidate = error as { statusCode?: number; code?: string };
      assert.equal(candidate.statusCode, 422);
      assert.equal(candidate.code, code);
      return true;
    },
  );
}

test("normalizes a Massive OPRA ticker to the exact 21-character OCC symbol", () => {
  assert.deepEqual(requireStandardOptionContractIdentity(standardContract), {
    occSymbol: "AAPL  260821C00200000",
    multiplier: 100,
    sharesPerContract: 100,
  });
});

test("accepts an exact padded OCC symbol", () => {
  assert.equal(
    requireStandardOptionContractIdentity({
      ...standardContract,
      contractSymbol: "aapl  260821c00200000",
    }).occSymbol,
    "AAPL  260821C00200000",
  );
});

test("rejects malformed contract symbols", () => {
  for (const contractSymbol of [
    "",
    "AAPL260821C0020000",
    "AAPL260832C00200000",
    "O:AAPL260821X00200000",
    "O:AAPL260821C00200000 EXTRA",
  ]) {
    expectHttpError(
      { ...standardContract, contractSymbol },
      "option_contract_symbol_invalid",
    );
  }
});

test("rejects a symbol that disagrees with any selected contract field", () => {
  for (const input of [
    { ...standardContract, underlyingSymbol: "MSFT" },
    { ...standardContract, expiration: "2026-08-22" },
    { ...standardContract, strike: 201 },
    { ...standardContract, optionType: "Put" as const },
  ]) {
    expectHttpError(input, "option_contract_identity_mismatch");
  }
});

test("rejects mini and adjusted-contract economics", () => {
  expectHttpError(
    { ...standardContract, multiplier: 10, sharesPerContract: 10 },
    "option_contract_multiplier_unsupported",
  );
  expectHttpError(
    { ...standardContract, sharesPerContract: 5 },
    "option_contract_deliverable_unsupported",
  );
});
