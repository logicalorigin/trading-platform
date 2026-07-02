function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

/** Deep-clone while capping every array to `perArray` items. */
function capArrays(value: unknown, perArray: number): unknown {
  if (Array.isArray(value)) {
    const capped: unknown[] = value.slice(0, perArray).map((item) => capArrays(item, perArray));
    if (value.length > perArray) {
      capped.push(`… +${value.length - perArray} more (truncated)`);
    }
    return capped;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = capArrays(item, perArray);
    }
    return out;
  }
  return value;
}

/**
 * Render a value as pretty JSON text for a tool result, enforcing a hard byte
 * cap so a large diagnostics payload can't blow the LLM context. Progressively
 * caps arrays before falling back to a raw cut.
 */
export function toToolText(value: unknown, maxBytes: number): string {
  const full = safeStringify(value);
  if (byteLength(full) <= maxBytes) {
    return full;
  }
  for (const cap of [50, 20, 5, 1]) {
    const text = safeStringify(capArrays(value, cap));
    if (byteLength(text) <= maxBytes) {
      return `${text}\n\n/* _truncated: arrays capped to ${cap} items to fit the ${maxBytes}-byte limit. Narrow the query (subsystem / severity / time window / limit) for more. */`;
    }
  }
  return `${full.slice(0, maxBytes)}\n\n/* _truncated: response hard-cut at ${maxBytes} bytes. */`;
}
