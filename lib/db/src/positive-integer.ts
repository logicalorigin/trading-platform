const CANONICAL_POSITIVE_DECIMAL_INTEGER = /^[1-9]\d*$/u;
// Larger Node timer delays are coerced to 1 ms; DB runtime limits share this parser.
const MAX_SIGNED_32_BIT_INTEGER = 2_147_483_647;

export function parseOptionalPositiveInteger(
  value: string | undefined,
): number | undefined {
  if (!value || !CANONICAL_POSITIVE_DECIMAL_INTEGER.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) &&
    parsed > 0 &&
    parsed <= MAX_SIGNED_32_BIT_INTEGER
    ? parsed
    : undefined;
}
