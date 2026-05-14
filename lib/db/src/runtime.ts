export type DatabaseRuntimeSource =
  | "workspace-local-postgres"
  | "replit-internal-dev-db"
  | "external-postgres";

export type DatabaseRuntimeSourceEnv = "DATABASE_URL" | "LOCAL_DATABASE_URL";

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

function classifyDatabaseRuntimeSource(url: URL): DatabaseRuntimeSource {
  const host = url.hostname || url.searchParams.get("host") || "";
  if (!url.hostname || host.includes(".local/postgres")) {
    return "workspace-local-postgres";
  }
  if (url.hostname === "helium") {
    return "replit-internal-dev-db";
  }
  return "external-postgres";
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

export function resolveDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfig {
  const databaseUrl = env["DATABASE_URL"] || null;
  const localDatabaseUrl = env["LOCAL_DATABASE_URL"] || null;
  const override = normalizeDatabaseSourceOverride(
    env["RAYALGO_DATABASE_SOURCE"],
  );
  const useLocalOverride = override === "local" && Boolean(localDatabaseUrl);
  const url = useLocalOverride ? localDatabaseUrl : databaseUrl;
  const sourceEnv: DatabaseRuntimeSourceEnv | null = useLocalOverride
    ? "LOCAL_DATABASE_URL"
    : url
      ? "DATABASE_URL"
      : null;

  if (!url || !sourceEnv) {
    return {
      url: null,
      source: null,
      sourceEnv: null,
      overrideActive: false,
    };
  }

  try {
    return {
      url,
      source: classifyDatabaseRuntimeSource(new URL(url)),
      sourceEnv,
      overrideActive: useLocalOverride,
    };
  } catch {
    return {
      url,
      source: null,
      sourceEnv,
      overrideActive: useLocalOverride,
    };
  }
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
    const user = url.username || url.searchParams.get("user") || null;
    return {
      ...config,
      configured: true,
      protocol: url.protocol.replace(/:$/, "") || null,
      host: url.hostname || url.searchParams.get("host") || null,
      port:
        url.port ||
        url.searchParams.get("port") ||
        (url.hostname ? "5432" : null),
      database: url.pathname.replace(/^\//, "") || null,
      user: user ? `${user.slice(0, 2)}***` : null,
      sslMode:
        url.searchParams.get("sslmode") ||
        url.searchParams.get("ssl") ||
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
