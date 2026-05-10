export type DatabaseRuntimeSource =
  | "workspace-local-postgres"
  | "replit-internal-dev-db"
  | "external-postgres";

export type DatabaseRuntimeSourceEnv = "LOCAL_DATABASE_URL" | "DATABASE_URL";

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

function classifyDatabaseRuntimeSource(
  sourceEnv: DatabaseRuntimeSourceEnv,
  url: URL,
): DatabaseRuntimeSource {
  const host = url.hostname || url.searchParams.get("host") || "";
  if (
    sourceEnv === "LOCAL_DATABASE_URL" &&
    (!url.hostname || host.includes(".local/postgres"))
  ) {
    return "workspace-local-postgres";
  }
  if (url.hostname === "helium") {
    return "replit-internal-dev-db";
  }
  return "external-postgres";
}

function shouldUseLocalDatabaseUrl(env: NodeJS.ProcessEnv): boolean {
  const preference = env["RAYALGO_DATABASE_SOURCE"]?.trim().toLowerCase();
  return (
    preference === "local" ||
    preference === "workspace-local-postgres" ||
    preference === "local-postgres"
  );
}

export function resolveDatabaseRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseRuntimeConfig {
  const localUrl = env["LOCAL_DATABASE_URL"];
  const runtimeUrl = env["DATABASE_URL"];
  const useLocalUrl = Boolean(localUrl && (!runtimeUrl || shouldUseLocalDatabaseUrl(env)));
  const url = useLocalUrl ? localUrl! : runtimeUrl || null;
  const sourceEnv = useLocalUrl
    ? "LOCAL_DATABASE_URL"
    : runtimeUrl
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
      source: classifyDatabaseRuntimeSource(sourceEnv, new URL(url)),
      sourceEnv,
      overrideActive: sourceEnv === "LOCAL_DATABASE_URL" && Boolean(runtimeUrl),
    };
  } catch {
    return {
      url,
      source: sourceEnv === "LOCAL_DATABASE_URL" ? "external-postgres" : null,
      sourceEnv,
      overrideActive: sourceEnv === "LOCAL_DATABASE_URL" && Boolean(runtimeUrl),
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
