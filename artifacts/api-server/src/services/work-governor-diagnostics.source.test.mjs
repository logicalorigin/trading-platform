import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platformSource = readFileSync(
  new URL("./platform.ts", import.meta.url),
  "utf8",
);
const recorderSource = readFileSync(
  new URL("./runtime-flight-recorder.ts", import.meta.url),
  "utf8",
);

test("full runtime diagnostics and the heartbeat expose work-governor state", () => {
  const fullStart = platformSource.indexOf(
    "export async function getRuntimeDiagnostics()",
  );
  const compactStart = platformSource.indexOf(
    "export async function getRuntimeDiagnosticsCompact()",
    fullStart,
  );
  assert.ok(fullStart >= 0 && compactStart > fullStart);
  const full = platformSource.slice(fullStart, compactStart);
  assert.match(full, /workGovernor:\s*getWorkGovernorSnapshot\(\)/);
  assert.match(
    recorderSource,
    /workGovernor:\s*getWorkGovernorSnapshot\(\)/,
  );
  assert.match(
    recorderSource,
    /setWorkGovernorTimingListener\(appendWorkGovernorTiming\)/,
  );
});

test("compact runtime diagnostics stays compact", () => {
  const compactStart = platformSource.indexOf(
    "export async function getRuntimeDiagnosticsCompact()",
  );
  const compactEnd = platformSource.indexOf(
    "export async function getAlgoGatewayReadinessSignals()",
    compactStart,
  );
  assert.ok(compactStart >= 0 && compactEnd > compactStart);
  assert.doesNotMatch(
    platformSource.slice(compactStart, compactEnd),
    /workGovernor:\s*getWorkGovernorSnapshot\(\)/,
  );
});
