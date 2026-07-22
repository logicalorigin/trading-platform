import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildDiagnosticsWindowParams } from "./diagnosticsDataLifecycle.js";

const source = readFileSync(
  new URL("../DiagnosticsScreen.jsx", import.meta.url),
  "utf8",
);

test("diagnostics rebuilds rolling windows when each request or export starts", () => {
  assert.doesNotMatch(source, /const timeWindow = useMemo\(/);
  assert.ok(
    (source.match(/buildDiagnosticsWindowParams\(windowMinutes\)/g) || [])
      .length >= 2,
    "history refresh and export must each sample the current time",
  );

  const first = buildDiagnosticsWindowParams(60, 1_000_000);
  const second = buildDiagnosticsWindowParams(60, 1_060_000);
  assert.equal(Date.parse(first.to) - Date.parse(first.from), 60 * 60_000);
  assert.equal(Date.parse(second.to) - Date.parse(second.from), 60 * 60_000);
  assert.equal(Date.parse(second.to) - Date.parse(first.to), 60_000);
});

test("diagnostics fallback polling recovers state and cancels after visibility cleanup", () => {
  const fallbackBlock =
    /if \(typeof window\.EventSource === "undefined"\) \{[\s\S]*?\n    \}\n\n    setStreamState\("connecting"\)/.exec(
      source,
    )?.[0] ?? "";

  assert.match(fallbackBlock, /setStreamState\("polling"\)[\s\S]*?setLatest/);
  assert.match(fallbackBlock, /const controller = new AbortController\(\)/);
  assert.match(fallbackBlock, /activeController\?\.abort\(\)/);
  assert.match(fallbackBlock, /cancelled = true/);
});

test("diagnostics marks a resumed event stream connecting before subscribing", () => {
  assert.match(
    source,
    /setStreamState\("connecting"\);\s*return subscribeDiagnosticsStream/,
  );
});

test("diagnostics contains rejected desktop-notification permission requests", () => {
  assert.match(
    source,
    /void Notification\.requestPermission\(\)\.catch\(\(\) => \{\}\)/,
  );
});

test("diagnostics event requests keep their selected scope and cancel stale detail", () => {
  assert.match(source, /const \[eventSubsystem, setEventSubsystem\] = useState\(""\)/);
  assert.match(source, /const eventSubsystemRef = useRef\(""\)/);
  assert.match(
    source,
    /const setEventScope = useCallback\(\(subsystem\) => \{\s*eventSubsystemRef\.current = subsystem;\s*setEventSubsystem\(subsystem\);/,
  );
  assert.match(
    source,
    /eventSubsystem\s*\?\s*\{ subsystem: eventSubsystem \}\s*:\s*\{\}/,
  );
  const selectionBlock =
    /const selectMetric = \(subsystem, metricKey\) => \{[\s\S]*?\n  \};/.exec(
      source,
    )?.[0] ?? "";
  assert.match(selectionBlock, /setEventScope\(subsystem\)/);
  assert.doesNotMatch(selectionBlock, /listDiagnosticEvents\(/);
  assert.match(
    source,
    /if \(!eventSubsystemRef\.current \|\| payload\.subsystem === eventSubsystemRef\.current\)/,
  );
  assert.doesNotMatch(
    source,
    /\}, \[eventSubsystem, isVisible, syncLocalAlertsFromSnapshot, updateLocalAlerts\]\);/,
  );

  const detailBlock =
    /useEffect\(\(\) => \{\s*if \(!eventsTabActive \|\| !selectedEvent\)[\s\S]*?\n  \}, \[eventsTabActive, selectedEvent\]\);/.exec(
      source,
    )?.[0] ?? "";
  assert.match(detailBlock, /new AbortController\(\)/);
  assert.match(detailBlock, /signal: controller\.signal/);
  assert.match(detailBlock, /return \(\) => controller\.abort\(\)/);
});

test("diagnostics keeps malformed snapshots and missing storage telemetry unknown", () => {
  assert.match(
    source,
    /function snapshotBySubsystem\(latest, subsystem\) \{\s*return arrayOrEmpty\(latest\?\.snapshots\)\.find/,
  );
  assert.doesNotMatch(source, /latest\?\.snapshots\?\.find/);
  assert.match(
    source,
    /const storageReachable =\s*typeof storageMetrics\.reachable === "boolean"\s*\? storageMetrics\.reachable\s*:\s*null/,
  );
  assert.doesNotMatch(
    source,
    /storageMetrics\.reachable \? "reachable" : "offline"/,
  );
  assert.doesNotMatch(
    source,
    /storageMetrics\.snapshotRetentionDays \|\| 7/,
  );
});
