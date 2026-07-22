import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readRouteSource = () =>
  readFileSync(new URL("./automation.ts", import.meta.url), "utf8");

test("manual Signal Options shadow scans stay abortable and action-budgeted", () => {
  const source = readRouteSource();
  const routeStart = source.indexOf(
    'router.post("/algo/deployments/:deploymentId/signal-options/shadow-scan"',
  );
  const routeEnd = source.indexOf(
    'router.post("/algo/deployments/:deploymentId/overnight-spot/scan"',
    routeStart,
  );
  assert.notEqual(routeStart, -1);
  assert.notEqual(routeEnd, -1);
  const routeSource = source.slice(routeStart, routeEnd);

  assert.match(source, /const SIGNAL_OPTIONS_SHADOW_SCAN_ROUTE_TIMEOUT_MS = 45_000;/);
  assert.match(source, /const SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS = 15_000;/);
  assert.match(source, /const SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT = 4;/);
  assert.match(
    source,
    /runWithDbAdmissionSignal\(taskSignal,\s*\(\) => task\(taskSignal\)\)/,
  );
  assert.match(routeSource, /withAbortableSignalOptionsRouteTimeout/);
  assert.match(routeSource, /signal,\s*\n\s*}\)/);
  assert.match(
    routeSource,
    /actionWorkBudgetMs:\s*SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_BUDGET_MS/,
  );
  assert.match(
    routeSource,
    /actionWorkItemLimit:\s*SIGNAL_OPTIONS_MANUAL_SCAN_ACTION_ITEM_LIMIT/,
  );
  assert.doesNotMatch(routeSource, /actionWorkBudgetMs:\s*null/);
  assert.doesNotMatch(routeSource, /actionWorkItemLimit:\s*null/);
});
