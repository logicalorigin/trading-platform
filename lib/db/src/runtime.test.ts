import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import {
  describeDatabaseRuntimeConnection,
  resolveDatabaseRuntimeConfig,
} from "./runtime";

const postgresEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  PGHOST: "helium",
  PGDATABASE: "pyrus",
  PGUSER: "runner",
  ...overrides,
});

test("Postgres environment keeps a valid TCP endpoint", () => {
  const config = resolveDatabaseRuntimeConfig(
    postgresEnv({
      PGPASSWORD: "p%:x",
      PGPORT: "6543",
      PGSSLMODE: "require",
    }),
  );

  assert.equal(config.source, "replit-internal-dev-db");
  assert.equal(config.sourceEnv, "PGHOST");
  const url = new URL(config.url!);
  assert.equal(url.hostname, "pghost.invalid");
  assert.equal(url.searchParams.get("host"), "helium");
  assert.equal(url.searchParams.get("port"), "6543");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");

  const client = new pg.Client({ connectionString: config.url! });
  assert.equal(client.host, "helium");
  assert.equal(client.password, "p%:x");
  assert.equal(client.port, 6543);
});

test("Postgres environment preserves a Unix socket endpoint", () => {
  const config = resolveDatabaseRuntimeConfig(
    postgresEnv({
      PGHOST: "/var/run/postgresql",
      PGUSER: "u@:/?# name",
      PGPASSWORD: "p@:/?# % ü",
      PGPORT: "6543",
    }),
  );

  assert.equal(config.source, "workspace-local-postgres");
  assert.equal(config.sourceEnv, "PGHOST");
  const url = new URL(config.url!);
  assert.equal(url.hostname, "pghost.invalid");
  assert.equal(url.pathname, "/pyrus");
  assert.equal(url.searchParams.get("host"), "/var/run/postgresql");
  assert.equal(url.searchParams.get("port"), "6543");

  const client = new pg.Client({ connectionString: config.url! });
  assert.equal(client.host, "/var/run/postgresql");
  assert.equal(client.user, "u@:/?# name");
  assert.equal(client.password, "p@:/?# % ü");
  assert.equal(client.database, "pyrus");
  assert.equal(client.port, 6543);
});

test("Postgres environment preserves IPv6 endpoints", () => {
  for (const host of ["::1", "[::1]"]) {
    const config = resolveDatabaseRuntimeConfig(postgresEnv({ PGHOST: host }));

    assert.equal(config.source, "external-postgres");
    assert.equal(config.sourceEnv, "PGHOST");
    const url = new URL(config.url!);
    assert.equal(url.hostname, "pghost.invalid");
    assert.equal(url.searchParams.get("host"), "::1");
    assert.equal(url.href.includes("localhost"), false);

    const client = new pg.Client({ connectionString: config.url! });
    assert.equal(client.host, "::1");
  }
});

test("database description reports the endpoint honored by pg", () => {
  const description = describeDatabaseRuntimeConnection({
    DATABASE_URL:
      "postgres://authority-user@authority.invalid:5433/pyrus?host=actual.invalid&port=6543&user=query-user",
  });

  assert.equal(description.host, "actual.invalid");
  assert.equal(description.port, "6543");
  assert.equal(description.user, "qu***");
});

test("database source and description use the last effective query host", () => {
  const env = {
    DATABASE_URL:
      "postgres://runner@helium/pyrus?host=/tmp/postgres&host=external.invalid",
  };
  const config = resolveDatabaseRuntimeConfig(env);
  const description = describeDatabaseRuntimeConnection(env);
  const client = new pg.Client({ connectionString: config.url! });

  assert.equal(client.host, "external.invalid");
  assert.equal(config.source, "external-postgres");
  assert.equal(description.host, "external.invalid");
});

test("Postgres environment rejects malformed or out-of-range ports", () => {
  for (const port of ["5432x", "abc", "0", "65536", "-1", "1.5", " 5432"]) {
    const config = resolveDatabaseRuntimeConfig(postgresEnv({ PGPORT: port }));
    assert.equal(config.url, null, port);
    assert.equal(config.source, null, port);
    assert.equal(config.sourceEnv, null, port);
  }
});

test("Postgres environment rejects delimiter-bearing TCP hosts", () => {
  for (const host of [
    "db.internal/path",
    "db.internal:5432",
    "user@db.internal",
    "db internal",
    "%2fetc",
  ]) {
    const config = resolveDatabaseRuntimeConfig(postgresEnv({ PGHOST: host }));
    assert.equal(config.url, null, host);
  }
});

test("Postgres environment rejects database names the URI parser cannot round-trip", () => {
  for (const database of ["db?shadow", "db#shadow", "db%shadow"]) {
    const config = resolveDatabaseRuntimeConfig(
      postgresEnv({ PGDATABASE: database }),
    );
    assert.equal(config.url, null, database);
  }
});
