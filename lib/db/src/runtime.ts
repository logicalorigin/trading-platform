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

export type DatabaseRuntimeDescription = Omit<DatabaseRuntimeConfig, "url"> & {
  url?: never;
  configured: boolean;
  protocol: string | null;
  host: string | null;
  port: string | null;
  database: string | null;
  user: string | null;
  sslMode: string | null;
  parseError: string | null;
};

const APPLICATION_OWNED_CONNECTION_PARAMS = [
  "application_name",
  "statement_timeout",
  "query_timeout",
  "idle_in_transaction_session_timeout",
  "options",
] as const;

const SAFE_SSL_DIAGNOSTIC_VALUES = new Set([
  "0",
  "1",
  "disable",
  "false",
  "no-verify",
  "prefer",
  "require",
  "true",
  "verify-ca",
  "verify-full",
]);

const MAX_DATABASE_DIAGNOSTIC_VALUE_LENGTH = 4_096;

function getLastSearchParam(url: URL, name: string): string | null {
  const values = url.searchParams.getAll(name);
  return values.length > 0 ? values[values.length - 1] || null : null;
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/u.test(value);
}

function hasCredentialUserinfo(value: string): boolean {
  const passwordSeparator = value.indexOf(":");
  const authoritySeparator = value.lastIndexOf("@");
  return passwordSeparator >= 0 && authoritySeparator > passwordSeparator + 1;
}

function isUnsafeDatabaseDiagnosticValue(value: string): boolean {
  return (
    hasControlCharacters(value) ||
    /\\u[\da-f]{4}/iu.test(value) ||
    value.includes("://") ||
    hasCredentialUserinfo(value) ||
    /(?:api[\s_-]*key|authorization|credential(?:s)?|pgpassword|sslpassword|pass(?:word|phrase)?|pwd|secret(?:[\s_-]*(?:access[\s_-]*)?key)?|token)[\\'"\s)\]}]*[:=]/iu.test(
      value,
    ) ||
    /--(?:api[\s_-]*key|authorization|credential(?:s)?|pgpassword|sslpassword|pass(?:word|phrase)?|pwd|secret|token)(?:\s+|=)\S/iu.test(
      value,
    ) ||
    /(?:^|\s)(?:--user(?:\s+|=)|-u(?:\s+|=)?)[^\s:]*:\S/iu.test(value) ||
    /(?:^|\s)(?:authorization[\s:=]+)?bearer\s+\S/iu.test(value) ||
    /(?:\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bsk-[A-Za-z0-9_-]{16,}\b|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b)/u.test(
      value,
    )
  );
}

export function safeDatabaseDiagnosticValue(
  value: string | null,
): string | null {
  if (!value || value.length > MAX_DATABASE_DIAGNOSTIC_VALUE_LENGTH) {
    return null;
  }

  let decoded = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (isUnsafeDatabaseDiagnosticValue(decoded)) {
      return null;
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) {
      return value;
    }
    decoded = next;
  }

  // Fail closed when a bounded decode still leaves an encoded payload.
  return isUnsafeDatabaseDiagnosticValue(decoded) ||
    /%[\da-f]{2}/iu.test(decoded)
    ? null
    : value;
}

function safeSslDiagnosticValue(value: string | null): string | null {
  return value && SAFE_SSL_DIAGNOSTIC_VALUES.has(value) ? value : null;
}

function unbracketIpv6Host(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
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
  const unbracketedHost = unbracketIpv6Host(host);
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
    const decodedUsername = decodeURIComponent(url.username);
    const decodedPassword = decodeURIComponent(url.password);
    if (
      hasControlCharacters(decodedPathname) ||
      hasControlCharacters(decodedUsername) ||
      hasControlCharacters(decodedPassword) ||
      Array.from(url.searchParams).some(
        ([name, entry]) =>
          hasControlCharacters(name) || hasControlCharacters(entry),
      )
    ) {
      return null;
    }
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

function normalizeEffectiveIpv6Host(url: URL): void {
  if (url.protocol === "socket:") return;
  const queryHost = getLastSearchParam(url, "host");
  const effectiveHost =
    queryHost || (url.hostname ? decodeURIComponent(url.hostname) : "");
  const unbracketedHost = unbracketIpv6Host(effectiveHost);
  if (unbracketedHost !== effectiveHost && isIP(unbracketedHost) === 6) {
    // pg-connection-string preserves brackets from URL authority hosts, but
    // Node's resolver expects a bare IPv6 literal. A query host is pg's
    // effective host and keeps the canonical URL usable by the client.
    url.searchParams.set("host", unbracketedHost);
  }
}

function stripApplicationOwnedConnectionParams(url: URL): void {
  for (const name of APPLICATION_OWNED_CONNECTION_PARAMS) {
    url.searchParams.delete(name);
  }
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
  const unbracketedHost = unbracketIpv6Host(host);
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
  normalizeEffectiveIpv6Host(parsedUrl);
  stripApplicationOwnedConnectionParams(parsedUrl);
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
  const { url, ...config } = resolveDatabaseRuntimeConfig(env);
  if (!url) {
    return {
      ...config,
      configured: false,
      protocol: null,
      host: null,
      port: null,
      database: null,
      user: null,
      sslMode: null,
      parseError: null,
    };
  }

  try {
    const parsedUrl = new URL(url);
    const socketUrl = parsedUrl.protocol === "socket:";
    const host = socketUrl
      ? decodeURI(parsedUrl.pathname)
      : getLastSearchParam(parsedUrl, "host") ||
        (parsedUrl.hostname ? decodeURIComponent(parsedUrl.hostname) : null);
    const user =
      getLastSearchParam(parsedUrl, "user") ||
      (parsedUrl.username ? decodeURIComponent(parsedUrl.username) : null) ||
      env["PGUSER"] ||
      pg.defaults.user ||
      null;
    const safeUser = safeDatabaseDiagnosticValue(user);
    const configuredPort =
      getLastSearchParam(parsedUrl, "port") ||
      parsedUrl.port ||
      env["PGPORT"] ||
      (host ? "5432" : null);
    const database = safeDatabaseDiagnosticValue(
      (socketUrl
        ? parsedUrl.searchParams.get("db") || null
        : decodeURI(parsedUrl.pathname.replace(/^\//, "")) || null) ||
        env["PGDATABASE"] ||
        user,
    );
    const sslMode = safeSslDiagnosticValue(
      getLastSearchParam(parsedUrl, "sslmode") ||
        getLastSearchParam(parsedUrl, "ssl") ||
        env["PGSSLMODE"] ||
        null,
    );
    return {
      ...config,
      configured: true,
      protocol: parsedUrl.protocol.replace(/:$/, "") || null,
      host: safeDatabaseDiagnosticValue(host),
      port: configuredPort ? String(Number.parseInt(configuredPort, 10)) : null,
      database,
      user: safeUser ? `${safeUser.slice(0, 2)}***` : null,
      sslMode,
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
