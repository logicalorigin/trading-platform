import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] =
  "postgres://test:test@helium:5432/heliumdb?sslmode=disable";
process.env["DB_CONNECTION_TIMEOUT_MS"] = "50";
process.env["DB_QUERY_TIMEOUT_MS"] = "50";
process.env["DB_STATEMENT_TIMEOUT_MS"] = "50";

const storageHealthModule = await import("./storage-health");
const {
  __resetStorageHealthForTests,
  __setStorageHealthProbeForTests,
  getCachedStorageHealthSnapshot,
  refreshStorageHealthSnapshot,
} = storageHealthModule;

test.afterEach(() => {
  __resetStorageHealthForTests();
});

test("storage health reports Replit dev DB connectivity failures explicitly", async () => {
  const error = new Error("Connection terminated due to connection timeout");
  Object.assign(error, { cause: new Error("Connection terminated unexpectedly") });
  __setStorageHealthProbeForTests(async () => {
    throw error;
  });

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, "replit-internal-dev-db");
  assert.equal(health.status, "unavailable");
  assert.equal(health.reachable, false);
  assert.equal(health.reason, "postgres_unreachable");
  assert.equal(health.transient, true);
  assert.equal(health.host, "helium");
  assert.equal(health.database, "heliumdb");
});

test("storage health caches successful probes for runtime diagnostics", async () => {
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();
  const cached = getCachedStorageHealthSnapshot();

  assert.equal(health.status, "ok");
  assert.equal(health.reachable, true);
  assert.equal(cached.status, "ok");
  assert.equal(cached.reason, null);
});
