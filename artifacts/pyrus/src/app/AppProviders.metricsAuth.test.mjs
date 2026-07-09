import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appProvidersSource = readFileSync(
  new URL("./AppProviders.tsx", import.meta.url),
  "utf8",
);
const performanceMetricsSource = readFileSync(
  new URL("../features/platform/performanceMetrics.ts", import.meta.url),
  "utf8",
);

test("performance metrics reporter is enabled only after auth is signed in", () => {
  assert.match(
    appProvidersSource,
    /function AuthenticatedRuntime/,
    "metrics reporting should run inside AuthProvider where auth state is available",
  );
  assert.match(
    appProvidersSource,
    /const authSession = useAuthSession\(\);/,
    "metrics reporting must read the canonical auth session",
  );
  assert.match(
    appProvidersSource,
    /usePyrusPerformanceMetricsReporter\(\{\s*enabled:\s*Boolean\(authSession\.signedIn[\s\S]*?\}\);/,
    "metrics reporting should be disabled for signed-out/auth-loading visitors",
  );
  assert.doesNotMatch(
    appProvidersSource,
    /export function AppProviders[\s\S]*?usePyrusPerformanceMetricsReporter\(\);/,
    "AppProviders must not start metrics reporting before AuthProvider",
  );
});

test("performance metrics hook accepts an enabled gate", () => {
  assert.match(
    performanceMetricsSource,
    /usePyrusPerformanceMetricsReporter = \(\{\s*enabled = true\s*\} = \{\}\)/,
    "the metrics hook should accept an enabled option",
  );
  assert.match(
    performanceMetricsSource,
    /if \(\s*!enabled[\s\S]*?typeof window === "undefined"/,
    "the metrics hook should install no timers/listeners when disabled",
  );
});
