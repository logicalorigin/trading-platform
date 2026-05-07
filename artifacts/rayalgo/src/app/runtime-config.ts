import { setBaseUrl } from "@workspace/api-client-react";

const LOOPBACK_API_HOSTS = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1"]);

const readImportMetaEnv = () =>
  ((import.meta as unknown as { env?: Record<string, unknown> }).env || {}) as {
    VITE_API_BASE_URL?: string;
  };

const isLoopbackHost = (host: string | null | undefined): boolean => {
  const normalized = String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, "$1");
  return LOOPBACK_API_HOSTS.has(normalized);
};

export const resolveBrowserApiBaseUrl = (
  rawValue: string | null | undefined,
  appLocationHref =
    typeof window === "undefined" ? "" : window.location.href,
): string | null => {
  const value = String(rawValue || "").trim();
  if (!value) {
    return null;
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(value);
  } catch {
    return value.replace(/\/+$/, "") || null;
  }

  if (isLoopbackHost(apiUrl.hostname)) {
    try {
      const appUrl = new URL(appLocationHref);
      if (!isLoopbackHost(appUrl.hostname)) {
        return null;
      }
    } catch {
      return null;
    }
  }

  return value.replace(/\/+$/, "");
};

const rawApiBaseUrl = readImportMetaEnv().VITE_API_BASE_URL ?? "";

export const runtimeConfig = {
  apiBaseUrl: resolveBrowserApiBaseUrl(rawApiBaseUrl),
} as const;

setBaseUrl(runtimeConfig.apiBaseUrl);
