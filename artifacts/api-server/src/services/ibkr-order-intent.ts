import { createHash } from "node:crypto";

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalJsonValue(entry)]),
    );
  }
  return value;
}

export function fingerprintIbkrOrderBody(
  body: Record<string, unknown>,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalJsonValue(body)))
    .digest("hex");
}
