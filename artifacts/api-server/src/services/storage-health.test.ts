import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const defaultDatabaseUrl = "postgres://test:test@helium:5432/heliumdb?sslmode=disable";
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const localPostgresRunDir = join(repoRoot, ".local/postgres/run");
const localDatabaseUrl = `postgres:///dev?host=${localPostgresRunDir}&user=runner`;
process.env["DATABASE_URL"] = defaultDatabaseUrl;
delete process.env["LOCAL_DATABASE_URL"];
delete process.env["RAYALGO_DATABASE_SOURCE"];
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
  process.env["DATABASE_URL"] = defaultDatabaseUrl;
  delete process.env["LOCAL_DATABASE_URL"];
  delete process.env["RAYALGO_DATABASE_SOURCE"];
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
  assert.equal(health.readWriteVerified, false);
  assert.equal(health.reason, "postgres_unreachable");
  assert.equal(health.transient, true);
  assert.equal(health.host, "helium");
  assert.equal(health.database, "heliumdb");
});

test("storage health reports missing DATABASE_URL", async () => {
  delete process.env["DATABASE_URL"];

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, null);
  assert.equal(health.sourceEnv, null);
  assert.equal(health.status, "unavailable");
  assert.equal(health.reachable, false);
  assert.equal(health.readWriteVerified, false);
  assert.equal(health.reason, "database_url_missing");
  assert.equal(health.error, "DATABASE_URL is not set.");
});

test("storage health reports local socket DATABASE_URL explicitly", async () => {
  process.env["DATABASE_URL"] = localDatabaseUrl;
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, "workspace-local-postgres");
  assert.equal(health.sourceEnv, "DATABASE_URL");
  assert.equal(health.overrideActive, false);
  assert.equal(health.status, "ok");
  assert.equal(health.readWriteVerified, true);
  assert.equal(health.host, localPostgresRunDir);
  assert.equal(health.database, "dev");
  assert.equal(health.user, "ru***");
});

test("storage health honors the workspace-local database source override", async () => {
  process.env["DATABASE_URL"] = defaultDatabaseUrl;
  process.env["LOCAL_DATABASE_URL"] = localDatabaseUrl;
  process.env["RAYALGO_DATABASE_SOURCE"] = "local";
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();

  assert.equal(health.source, "workspace-local-postgres");
  assert.equal(health.sourceEnv, "LOCAL_DATABASE_URL");
  assert.equal(health.overrideActive, true);
  assert.equal(health.status, "ok");
  assert.equal(health.host, localPostgresRunDir);
  assert.equal(health.database, "dev");
});

test("storage health caches successful probes for runtime diagnostics", async () => {
  __setStorageHealthProbeForTests(async () => {});

  const health = await refreshStorageHealthSnapshot();
  const cached = getCachedStorageHealthSnapshot();

  assert.equal(health.status, "ok");
  assert.equal(health.reachable, true);
  assert.equal(health.readWriteVerified, true);
  assert.equal(cached.status, "ok");
  assert.equal(cached.reason, null);
});
