export type OptionIntrinsicContract = {
  strike?: unknown;
  right?: unknown;
  cp?: unknown;
} | null;

export function optionIntrinsicValue(
  optionContract: OptionIntrinsicContract | undefined,
  underlyingPrice: unknown,
): number | null;

export function floorOptionMarkAtIntrinsic(input: {
  mark: unknown;
  optionContract: OptionIntrinsicContract | undefined;
  underlyingPrice: unknown;
}): number | null;
