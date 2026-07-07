export type BrokerAccountCategory =
  | "crypto"
  | "futures"
  | "prediction"
  | "equity";

export function classifyBrokerAccountCategory(
  displayName: string | null | undefined,
): BrokerAccountCategory {
  const name = displayName ?? "";
  if (/\bcrypto\b/iu.test(name)) {
    return "crypto";
  }
  if (/\bfutures\b/iu.test(name)) {
    return "futures";
  }
  if (/\bevents?\b/iu.test(name)) {
    return "prediction";
  }
  return "equity";
}
