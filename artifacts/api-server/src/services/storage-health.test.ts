import assert from "node:assert/strict";
import test from "node:test";

process.env["DATABASE_URL"] =
  "postgres://test:test@helium:5432/heliumdb?sslmode=disable";
const previousLocalDatabaseUrl = process.env["LOCAL_DATABASE_URL"];
delete process.env["LOCAL_DATABASE_URL"];
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
  delete process.env["LOCAL_DATABASE_URL"];
  delete process.env["RAYALGO_DATABASE_SOURCE"];
  __resetStorageHealthForTests();
});

test.after(() => {
  if (previousLocalDatabaseUrl === undefined) {
    delete process.env["LOCAL_DATABASE_URL"];
  } else {
    process.env["LOCAL_DATABASE_URL"] = previousLocalDatabaseUrl;
  }
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

test("storage health reports the effective local database override", async () => {
  process.env["LOCAL_DATABASE_URL"] =
    "postgres:///dev?host=/home/runner/workspace/.local/postgres/run&user=runner";
  process.env["RAYALGO_DATABASE_SOURCE"] = "local";
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, "workspace-local-postgres");
  assert.equal(health.sourceEnv, "LOCAL_DATABASE_URL");
  assert.equal(health.overrideActive, true);
  assert.equal(health.status, "ok");
  assert.equal(health.host, "/home/runner/workspace/.local/postgres/run");
  assert.equal(health.database, "dev");
  assert.equal(health.user, "ru***");
});

test("storage health prefers the managed Replit database unless local is explicit", async () => {
  process.env["LOCAL_DATABASE_URL"] =
    "postgres:///dev?host=/home/runner/workspace/.local/postgres/run&user=runner";
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, "replit-internal-dev-db");
  assert.equal(health.sourceEnv, "DATABASE_URL");
  assert.equal(health.overrideActive, false);
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
