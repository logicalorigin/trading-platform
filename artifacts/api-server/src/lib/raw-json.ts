// Marker for an already-serialized JSON payload. Passing `new RawJson(jsonString)`
// to `res.json(...)` lets the gzip/serialize middleware skip a second JSON.stringify
// of a large body (the hot /signal-monitor/state poll serializes ~2.4 MB). The brand
// check (not instanceof) stays correct even if this module is duplicated across
// bundles.
export class RawJson {
  readonly __rawJson = true as const;
  constructor(public readonly value: string) {}
}

export function isRawJson(value: unknown): value is RawJson {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __rawJson?: unknown }).__rawJson === true
  );
}
