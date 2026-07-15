import { isIP } from "node:net";

import pg from "pg";

export type DatabaseRuntimeSource =
  | "workspace-local-postgres"
  | "replit-internal-dev-db"
  | "external-postgres";

export type DatabaseRuntimeSourceEnv =
  | "DATABASE_URL"
  | "LOCAL_DATABASE_URL"
  | "PGHOST";

export type DatabaseRuntimeConfig = {
  url: string | null;
  source: DatabaseRuntimeSource | null;
  sourceEnv: DatabaseRuntimeSourceEnv | null;
  overrideActive: boolean;
};

export type DatabaseRuntimeDescription = DatabaseRuntimeConfig & {
  configured: boolean;
  protocol: string | null;
  host: string | null;
  port: string | null;
  database: string | null;
  user: string | null;
  sslMode: string | null;
  parseError: string | null;
};

function getLastSearchParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length > 0 ? values[values.length - 1] || null : null;
}

function classifyDatabaseRuntimeSource(url: URL): DatabaseRuntimeSource {
  if (url.protocol === "socket:") {
    return "workspace-local-postgres";
  }
  const host =
    getLastSearchParam(url, "host") ||
    (url.hostname ? decodeURIComponent(url.hostname) : "");
  if (!host || host.startsWith("/") || host.includes(".local/postgres")) {
    return "workspace-local-postgres";
  }
  if (host.toLowerCase() === "helium") {
    return "replit-internal-dev-db";
  }
  return "external-postgres";
}

function isValidPostgresPort(port: string | null | undefined): boolean {
  return (
    !port ||
    (/^\d+$/u.test(port) && Number(port) >= 1 && Number(port) <= 65_535)
  );
}

function isValidPostgresHost(host: string): boolean {
  if (!host) {
    return true;
  }
  if (/[\u0000-\u001f\u007f]/u.test(host)) {
    return false;
  }
  if (host.startsWith("/")) {
    return true;
  }
  const unbracketedHost =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  return (
    isIP(unbracketedHost) === 6 ||
    (!/[%/\\@?#:\s]/u.test(host) && !host.includes("[") && !host.includes("]"))
  );
}

function parseDatabaseRuntimeUrl(value: string | null): URL | null {
  if (
    !value ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    /%(?![\da-f]{2})/iu.test(value)
  ) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "postgres:" &&
      url.protocol !== "postgresql:" &&
      url.protocol !== "socket:"
    ) {
      return null;
    }
    const decodedPathname = decodeURI(url.pathname);
    if (
      url.protocol === "socket:" &&
      (!decodedPathname.startsWith("/") ||
        !isValidPostgresHost(decodedPathname))
    ) {
      return null;
    }
    if (!isValidPostgresPort(getLastSearchParam(url, "port") || url.port)) {
      return null;
    }
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
    if (url.protocol !== "socket:") {
      const host =
        getLastSearchParam(url, "host") ||
        (url.hostname ? decodeURIComponent(url.hostname) : "");
      if (!host || !isValidPostgresHost(host)) {
        return null;
      }
    }
    return url;
  } catch {
    return null;
  }
}

function disableHeliumSsl(url: URL): string {
  for (const name of [
    "ssl",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "uselibpqcompat",
  ]) {
    url.searchParams.delete(name);
  }
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}

function classifyDatabaseRuntimeSourceFromUrl(
  url: string | null,
): DatabaseRuntimeSource | null {
  const parsed = parseDatabaseRuntimeUrl(url);
  return parsed ? classifyDatabaseRuntimeSource(parsed) : null;
}

function normalizeDatabaseSourceOverride(
  value: string | undefined,
): "local" | "database_url" | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("_", "-");
  if (
    normalized === "local" ||
    normalized === "local-database-url" ||
    normalized === "workspace-local" ||
    normalized === "workspace-local-postgres"
  ) {
    return "local";
  }
  if (
    normalized === "database-url" ||
    normalized === "primary" ||
    normalized === "default"
  ) {
    return "database_url";
  }
  return null;
}

function buildPostgresEnvDatabaseUrl(env: NodeJS.ProcessEnv): string | null {
  const host = env["PGHOST"];
  const database = env["PGDATABASE"];
  const user = env["PGUSER"];
  if (!host || !database || !user) {
    return null;
  }

  const port = env["PGPORT"];
  if (!isValidPostgresPort(port)) {
    return null;
  }

  const url = new URL("postgres://pghost.invalid");
  const unbracketedHost =
    host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const ipv6Host = isIP(unbracketedHost) === 6;
  if (!isValidPostgresHost(host)) {
    return null;
  }
  url.searchParams.set("host", ipv6Host ? unbracketedHost : host);
  if (port) {
    url.searchParams.set("port", port);
  }
  try {
    url.username = encodeURIComponent(user);
    if (env["PGPASSWORD"]) {
      url.password = encodeURIComponent(env["PGPASSWORD"]);
    }
  } catch {
    return null;
  }
  url.pathname = `/${database}`;
  try {
    if (decodeURI(url.pathname.slice(1)) !== database) {
      return null;
    }
  } catch {
    return null;
  }
  if (env["PGSSLMODE"]) {
    url.searchParams.set("sslmode", normalizeNodePgSslMode(env["PGSSLMODE"]));
  }
  return url.toString();
}

function normalizeNodePgSslMode(value: string): string {
  const normalized = value.trim().toLowerCase();
  return normalized === "prefer" ||
    normalized === "require" ||
    normalized === "verify-ca"
    ? "verify-full"
    : value;
}

export function resolveDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfig {
  const databaseUrl = env["DATABASE_URL"] || null;
  const localDatabaseUrl = env["LOCAL_DATABASE_URL"] || null;
  const postgresEnvDatabaseUrl = buildPostgresEnvDatabaseUrl(env);
  const override = normalizeDatabaseSourceOverride(
    env["PYRUS_DATABASE_SOURCE"],
  );
  const useLocalOverride = override === "local" && Boolean(localDatabaseUrl);
  const databaseUrlSource = classifyDatabaseRuntimeSourceFromUrl(databaseUrl);
  const postgresEnvDatabaseUrlSource = classifyDatabaseRuntimeSourceFromUrl(
    postgresEnvDatabaseUrl,
  );
  const useReplitPgEnv =
    override !== "database_url" &&
    Boolean(postgresEnvDatabaseUrl) &&
    postgresEnvDatabaseUrlSource === "replit-internal-dev-db" &&
    databaseUrlSource === "workspace-local-postgres";

  let url: string | null = null;
  let sourceEnv: DatabaseRuntimeSourceEnv | null = null;
  if (useLocalOverride) {
    url = localDatabaseUrl;
    sourceEnv = "LOCAL_DATABASE_URL";
  } else if (useReplitPgEnv) {
    url = postgresEnvDatabaseUrl;
    sourceEnv = "PGHOST";
  } else if (databaseUrl) {
    url = databaseUrl;
    sourceEnv = "DATABASE_URL";
  } else if (postgresEnvDatabaseUrl) {
    url = postgresEnvDatabaseUrl;
    sourceEnv = "PGHOST";
  }

  if (!url || !sourceEnv) {
    return {
      url: null,
      source: null,
      sourceEnv: null,
      overrideActive: false,
    };
  }

  const parsedUrl = parseDatabaseRuntimeUrl(url);
  if (!parsedUrl) {
    return {
      url: null,
      source: null,
      sourceEnv: null,
      overrideActive: false,
    };
  }
  const source = classifyDatabaseRuntimeSource(parsedUrl);
  return {
    url:
      source === "replit-internal-dev-db"
        ? disableHeliumSsl(parsedUrl)
        : parsedUrl.toString(),
    source,
    sourceEnv,
    overrideActive: useLocalOverride,
  };
}

export function describeDatabaseRuntimeConnection(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeDescription {
  const config = resolveDatabaseRuntimeConfig(env);
  if (!config.url) {
    return {
      ...config,
      configured: false,
      protocol: null,
      host: env["PGHOST"] || null,
      port: env["PGPORT"] || null,
      database: env["PGDATABASE"] || null,
      user: env["PGUSER"] ? `${env["PGUSER"]!.slice(0, 2)}***` : null,
      sslMode: env["PGSSLMODE"] || null,
      parseError: null,
    };
  }

  try {
    const url = new URL(config.url);
    const socketUrl = url.protocol === "socket:";
    const host = socketUrl
      ? decodeURI(url.pathname)
      : getLastSearchParam(url, "host") ||
        (url.hostname ? decodeURIComponent(url.hostname) : null);
    const user =
      getLastSearchParam(url, "user") ||
      (url.username ? decodeURIComponent(url.username) : null) ||
      env["PGUSER"] ||
      pg.defaults.user ||
      null;
    const configuredPort =
      getLastSearchParam(url, "port") ||
      url.port ||
      env["PGPORT"] ||
      (host ? "5432" : null);
    const database =
      (socketUrl
        ? url.searchParams.get("db") || null
        : decodeURI(url.pathname.replace(/^\//, "")) || null) ||
      env["PGDATABASE"] ||
      user;
    return {
      ...config,
      configured: true,
      protocol: url.protocol.replace(/:$/, "") || null,
      host,
      port: configuredPort ? String(Number.parseInt(configuredPort, 10)) : null,
      database,
      user: user ? `${user.slice(0, 2)}***` : null,
      sslMode:
        getLastSearchParam(url, "sslmode") ||
        getLastSearchParam(url, "ssl") ||
        env["PGSSLMODE"] ||
        null,
      parseError: null,
    };
  } catch (error) {
    return {
      ...config,
      configured: true,
      protocol: null,
      host: null,
      port: null,
      database: null,
      user: null,
      sslMode: null,
      parseError: error instanceof Error ? error.message : String(error),
    };
  }
}
