import assert from "node:assert/strict";
import test from "node:test";

import {
  getPostgresDiagnosticContext,
  runWithPostgresDiagnosticContext,
} from "./index";

test("postgres diagnostic context propagates through async work and does not leak", async () => {
  assert.equal(getPostgresDiagnosticContext(), null);

  await runWithPostgresDiagnosticContext(
    {
      requestId: "req-ctx",
      method: "GET",
      path: "/api/flow/events",
      route: "GET /api/flow/events",
      routeClass: "live-data",
      requestFamily: "flow-events",
      clientRole: "flow-screen",
      fetchPriority: 5,
      requestOrigin: "flow",
      admissionAction: "allow",
      workloadFamily: "live-data",
    },
    async () => {
      await Promise.resolve();
      assert.equal(getPostgresDiagnosticContext()?.requestId, "req-ctx");
      assert.equal(getPostgresDiagnosticContext()?.routeClass, "live-data");
    },
  );

  assert.equal(getPostgresDiagnosticContext(), null);
});

// Regression guard for the bar_cache attribution bug. A drizzle query builder is
// a LAZY thenable: the work (here, the context read standing in for pool.query)
// runs when `.then()` is invoked, not when the builder is created. The store
// helpers (runWithMarketDataStoreContext / runWithOptionMetadataContext) used to
// pass that thenable straight to als.run, so the query fired from the caller's
// later `await` — after the scope was restored — landing every background
// bar_cache op as null-context. The fix awaits `fn()` INSIDE the scope.
test("postgres diagnostic context survives a lazy thenable resolved inside the scope", async () => {
  const makeLazyThenable = (record: (family: string | null) => void) => ({
    then(resolve: (value: undefined) => void): void {
      record(getPostgresDiagnosticContext()?.workloadFamily ?? null);
      resolve(undefined);
    },
  });

  // The OLD (buggy) shape: pass the lazy thenable straight through. The caller
  // awaits it after run() has already restored the previous (null) store.
  let buggySeen: string | null = "unset" as unknown as string | null;
  assert.equal(getPostgresDiagnosticContext(), null);
  const buggy = runWithPostgresDiagnosticContext(
    { routeClass: "background", workloadFamily: "bar-cache-read" },
    () => makeLazyThenable((family) => {
      buggySeen = family;
    }),
  );
  await buggy;
  assert.equal(buggySeen, null);

  // The FIXED shape: resolve the thenable inside the diagnostic scope.
  let fixedSeen: string | null = "unset" as unknown as string | null;
  const fixed = runWithPostgresDiagnosticContext(
    { routeClass: "background", workloadFamily: "bar-cache-read" },
    async () => makeLazyThenable((family) => {
      fixedSeen = family;
    }),
  );
  await fixed;
  assert.equal(fixedSeen, "bar-cache-read");

  assert.equal(getPostgresDiagnosticContext(), null);
});
