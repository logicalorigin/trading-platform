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
      PGHOST: "db.internal",
      PGPASSWORD: "p%:x",
      PGPORT: "6543",
      PGSSLMODE: "require",
    }),
  );

  assert.equal(config.source, "external-postgres");
  assert.equal(config.sourceEnv, "PGHOST");
  const url = new URL(config.url!);
  assert.equal(url.hostname, "pghost.invalid");
  assert.equal(url.searchParams.get("host"), "db.internal");
  assert.equal(url.searchParams.get("port"), "6543");
  assert.equal(url.searchParams.get("sslmode"), "verify-full");

  const client = new pg.Client({ connectionString: config.url! });
  assert.equal(client.host, "db.internal");
  assert.equal(client.password, "p%:x");
  assert.equal(client.port, 6543);
});

test("Helium Postgres environment keeps the plaintext client policy", () => {
  for (const host of ["helium", "HELIUM"]) {
    const config = resolveDatabaseRuntimeConfig(
      postgresEnv({ PGHOST: host, PGSSLMODE: "require" }),
    );

    assert.equal(config.source, "replit-internal-dev-db", host);
    const url = new URL(config.url!);
    assert.equal(url.searchParams.get("sslmode"), "disable", host);

    const client = new pg.Client({ connectionString: config.url!, ssl: false });
    assert.equal(client.ssl, false, host);
  }
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

test("socket URLs describe the endpoint honored by pg", () => {
  const env = {
    DATABASE_URL:
      "socket:/var/run/postgresql?db=pyrus&db=ignored&user=ignored&user=runner&port=5432&port=6543",
  };
  const config = resolveDatabaseRuntimeConfig(env);
  const description = describeDatabaseRuntimeConnection(env);
  const client = new pg.Client({ connectionString: config.url! });

  assert.equal(config.source, "workspace-local-postgres");
  assert.equal(description.host, client.host);
  assert.equal(description.port, String(client.port));
  assert.equal(description.database, client.database);
  assert.equal(description.user, "ru***");
});

test("database URL diagnostics normalize the pg environment port fallback", () => {
  const previousPort = process.env.PGPORT;

  try {
    for (const port of ["05432", "5432x", "5e3", " 5432"]) {
      process.env.PGPORT = port;
      const env = {
        DATABASE_URL: "postgres://runner@db.internal/pyrus",
        PGPORT: port,
      };
      const config = resolveDatabaseRuntimeConfig(env);
      const description = describeDatabaseRuntimeConnection(env);
      const client = new pg.Client({ connectionString: config.url! });

      assert.equal(description.port, String(client.port), port);
    }
  } finally {
    if (previousPort === undefined) {
      delete process.env.PGPORT;
    } else {
      process.env.PGPORT = previousPort;
    }
  }
});

test("database diagnostics normalize URL ports like pg", () => {
  for (const url of [
    "postgres://runner@db.internal/pyrus?port=05432",
    "socket:/var/run/postgresql?db=pyrus&user=runner&port=05432",
  ]) {
    const env = { DATABASE_URL: url };
    const config = resolveDatabaseRuntimeConfig(env);
    const description = describeDatabaseRuntimeConnection(env);
    const client = new pg.Client({ connectionString: config.url! });

    assert.equal(description.port, String(client.port), url);
  }
});

test("database diagnostics honor pg user and database fallbacks", () => {
  const previousUser = process.env.PGUSER;
  const previousDatabase = process.env.PGDATABASE;
  process.env.PGUSER = "env-user";
  delete process.env.PGDATABASE;

  try {
    for (const url of [
      "postgres://db.internal",
      "socket:/var/run/postgresql",
      "postgres://url-user@db.internal",
      "socket:/var/run/postgresql?user=url-user",
    ]) {
      const env = { DATABASE_URL: url, PGUSER: "env-user" };
      const config = resolveDatabaseRuntimeConfig(env);
      const description = describeDatabaseRuntimeConnection(env);
      const client = new pg.Client({ connectionString: config.url! });

      assert.equal(description.database, client.database, url);
      assert.equal(
        description.user,
        client.user ? `${client.user.slice(0, 2)}***` : null,
        url,
      );
    }
  } finally {
    if (previousUser === undefined) {
      delete process.env.PGUSER;
    } else {
      process.env.PGUSER = previousUser;
    }
    if (previousDatabase === undefined) {
      delete process.env.PGDATABASE;
    } else {
      process.env.PGDATABASE = previousDatabase;
    }
  }
});

test("database diagnostics honor pg's platform user default", () => {
  const previousUser = process.env.PGUSER;
  const previousDatabase = process.env.PGDATABASE;
  const previousDefaultUser = pg.defaults.user;
  delete process.env.PGUSER;
  delete process.env.PGDATABASE;
  pg.defaults.user = "platform-user";

  try {
    const env = { DATABASE_URL: "postgres://db.internal" };
    const config = resolveDatabaseRuntimeConfig(env);
    const description = describeDatabaseRuntimeConnection(env);
    const client = new pg.Client({ connectionString: config.url! });

    assert.equal(description.database, client.database);
    assert.equal(
      description.user,
      client.user ? `${client.user.slice(0, 2)}***` : null,
    );
  } finally {
    if (previousUser === undefined) {
      delete process.env.PGUSER;
    } else {
      process.env.PGUSER = previousUser;
    }
    if (previousDatabase === undefined) {
      delete process.env.PGDATABASE;
    } else {
      process.env.PGDATABASE = previousDatabase;
    }
    pg.defaults.user = previousDefaultUser;
  }
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

test("Postgres environment rejects control characters in endpoints", () => {
  for (const host of [
    "db\u0000.internal",
    "db\u001f.internal",
    "db\u007f.internal",
    "/var/run/postgresql\u0000",
  ]) {
    assert.equal(
      resolveDatabaseRuntimeConfig(postgresEnv({ PGHOST: host })).url,
      null,
    );
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

test("selected database URLs fail closed instead of falling through to pg defaults", () => {
  const invalidUrls = [
    "not-a-url",
    "http://runner@db.internal/pyrus",
    "postgres:foo",
    "postgres:/foo",
    "postgres:///foo",
    "postgres://runner@db.internal:abc/pyrus",
    "postgres://runner@db.internal:0/pyrus",
    "postgres://runner@db.internal/pyrus?port=5432x",
    "postgres://runner@db.internal/pyrus?port=65536",
    "postgres://runner@db.internal/pyrus?host=evil.invalid:5432",
    "postgres://runner@db.internal/pyrus?host=%00",
    "postgres://runner@db.internal/pyrus?host=%1F",
    "postgres://runner@db.internal/pyrus?host=%2Ftmp%2Fpostgres%00",
    "postgres://runner@db.internal/pyrus%ZZ",
    "socket:/tmp/postgres%00?db=pyrus",
    "socket:/tmp/postgres%1F?db=pyrus",
    "socket:/tmp/postgres%7F?db=pyrus",
    "socket:/tmp/post\ngres?db=pyrus",
    "socket:relative?db=pyrus",
  ];

  for (const url of invalidUrls) {
    for (const env of [
      postgresEnv({ DATABASE_URL: url }),
      postgresEnv({
        DATABASE_URL: "postgres://runner@db.internal/pyrus",
        LOCAL_DATABASE_URL: url,
        PYRUS_DATABASE_SOURCE: "local",
      }),
    ]) {
      const config = resolveDatabaseRuntimeConfig(env);
      assert.equal(config.url, null, url);
      assert.equal(config.source, null, url);
      assert.equal(config.sourceEnv, null, url);
    }
  }
});

test("selected database URLs preserve supported Postgres and socket forms", () => {
  for (const url of [
    "postgres://runner@db.internal:5432/pyrus",
    "postgresql://runner@db.internal/pyrus",
    "postgres:///dev?host=%2Ftmp%2Fpostgres&port=5432",
    "socket:/var/run/postgresql?db=pyrus&user=runner",
  ]) {
    assert.equal(resolveDatabaseRuntimeConfig({ DATABASE_URL: url }).url, url);
  }
});

test("selected database URLs pass the validated canonical form to pg", () => {
  const config = resolveDatabaseRuntimeConfig({
    DATABASE_URL: " postgres://runner@db.internal/pyrus ",
  });

  assert.equal(config.url, "postgres://runner@db.internal/pyrus");
  const client = new pg.Client({ connectionString: config.url! });
  assert.equal(client.host, "db.internal");
  assert.equal(client.user, "runner");
  assert.equal(client.database, "pyrus");
});
