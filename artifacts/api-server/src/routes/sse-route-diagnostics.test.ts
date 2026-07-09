import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

for (const [file, stream] of [
  ["./marketing.ts", "marketing-shadow-dashboard"],
  ["./automation.ts", "algo-cockpit"],
] as const) {
  test(`${stream} route records SSE lifecycle and serialization diagnostics`, () => {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");

    assert.match(source, /serializeSseEventData\(payload\)/);
    assert.match(source, new RegExp(`recordSseStreamOpen\\("${stream}"\\)`));
    assert.match(
      source,
      new RegExp(`recordSseStreamClose\\("${stream}", closeReason\\)`),
    );
    assert.match(source, /closeReason = "request_aborted"/);
    assert.match(source, /closeReason = "client_close"/);
    assert.match(source, /closeReason = "setup_error"/);
  });
}
