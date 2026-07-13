import { HttpError } from "../lib/errors";

export type StandardOptionContractIdentityInput = {
  contractSymbol: string;
  multiplier: number;
  sharesPerContract: number;
  underlyingSymbol: string;
  expiration: string;
  strike: number;
  optionType: "Call" | "Put";
};

export type StandardOptionContractIdentity = {
  occSymbol: string;
  multiplier: 100;
  sharesPerContract: 100;
};

const COMPACT_OCC_PATTERN = /^([A-Z0-9.]{1,6})(\d{6})([CP])(\d{8})$/u;
const PADDED_OCC_PATTERN = /^([A-Z0-9.]{1,6})( {0,5})(\d{6})([CP])(\d{8})$/u;

function invalidSymbol(): never {
  throw new HttpError(422, "The selected option contract symbol is invalid", {
    code: "option_contract_symbol_invalid",
  });
}

function parseContractSymbol(value: string): {
  underlying: string;
  expiration: string;
  strike: number;
  optionType: "Call" | "Put";
  occSymbol: string;
} {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  const body = normalized.startsWith("O:") ? normalized.slice(2) : normalized;
  const compactMatch = COMPACT_OCC_PATTERN.exec(body);
  const paddedMatch = PADDED_OCC_PATTERN.exec(body);
  const match = compactMatch ?? paddedMatch;
  if (!match) invalidSymbol();

  const underlying = match[1];
  const padding = compactMatch ? "" : match[2] ?? "";
  const yymmdd = compactMatch ? match[2] : match[3];
  const right = compactMatch ? match[3] : match[4];
  const strikeDigits = compactMatch ? match[4] : match[5];
  if (
    !underlying ||
    !yymmdd ||
    !right ||
    !strikeDigits ||
    (!compactMatch && underlying.length + padding.length !== 6)
  ) {
    invalidSymbol();
  }

  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalidSymbol();
  }

  return {
    underlying,
    expiration: date.toISOString().slice(0, 10),
    strike: Number(strikeDigits) / 1_000,
    optionType: right === "C" ? "Call" : "Put",
    occSymbol: `${underlying.padEnd(6, " ")}${yymmdd}${right}${strikeDigits}`,
  };
}

export function requireStandardOptionContractIdentity(
  input: StandardOptionContractIdentityInput,
): StandardOptionContractIdentity {
  if (input.multiplier !== 100) {
    throw new HttpError(
      422,
      "Only standard 100x option multipliers are supported",
      { code: "option_contract_multiplier_unsupported" },
    );
  }
  if (input.sharesPerContract !== 100) {
    throw new HttpError(422, "Adjusted option deliverables are not supported", {
      code: "option_contract_deliverable_unsupported",
    });
  }

  const contract = parseContractSymbol(input.contractSymbol);
  const expectedUnderlying = input.underlyingSymbol.trim().toUpperCase();
  if (
    contract.underlying !== expectedUnderlying ||
    contract.expiration !== input.expiration ||
    contract.strike !== input.strike ||
    contract.optionType !== input.optionType
  ) {
    throw new HttpError(
      422,
      "The selected option contract does not match the order ticket",
      { code: "option_contract_identity_mismatch" },
    );
  }

  return {
    occSymbol: contract.occSymbol,
    multiplier: 100,
    sharesPerContract: 100,
  };
}
