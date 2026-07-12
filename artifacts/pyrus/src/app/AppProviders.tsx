import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type PropsWithChildren } from "react";
import { AuthProvider, useAuthSession } from "../features/auth/authSession.jsx";
import { usePyrusPerformanceMetricsReporter } from "../features/platform/performanceMetrics";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      // Mirrors react-query's numeric `retry: 1` (failureCount < 1) but never
      // retries a client-side timeout — re-firing it just re-hangs against an
      // unresponsive backend and re-consumes the freed connection.
      retry: (failureCount, error) =>
        error?.name !== "TimeoutError" && failureCount < 1,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});

const LOCAL_STORAGE_WARN_BYTES = 2 * 1024 * 1024;
const RETIRED_QUERY_CACHE_KEY = "pyrus-react-query-cache";
let storageAuditCompleted = false;

const clearRetiredQueryCache = () => {
  try {
    window.localStorage?.removeItem(RETIRED_QUERY_CACHE_KEY);
  } catch {}
};

const auditLocalStorageOnce = () => {
  if (storageAuditCompleted) return;
  storageAuditCompleted = true;

  if (!import.meta.env.DEV) return;
  if (typeof window === "undefined" || !window.localStorage) return;

  try {
    let totalChars = 0;
    const breakdown: Array<{ key: string; bytes: number }> = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      const value = window.localStorage.getItem(key) ?? "";
      const bytes = (key.length + value.length) * 2;
      totalChars += bytes;
      breakdown.push({ key, bytes });
    }

    const totalKb = Math.round(totalChars / 1024);
    if (totalChars >= LOCAL_STORAGE_WARN_BYTES) {
      const top = breakdown
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5)
        .map((entry) => `${entry.key} (${Math.round(entry.bytes / 1024)} KB)`)
        .join(", ");
      console.warn(
        `[pyrus] localStorage holds ~${totalKb} KB across ${breakdown.length} keys. Top: ${top}`,
      );
    } else {
      console.info(
        `[pyrus] localStorage audit: ~${totalKb} KB across ${breakdown.length} keys.`,
      );
    }
  } catch (error) {
    console.warn("[pyrus] localStorage audit failed", error);
  }
};

function AuthenticatedRuntime({ children }: PropsWithChildren) {
  const authSession = useAuthSession();
  usePyrusPerformanceMetricsReporter({
    enabled: Boolean(authSession.signedIn && !authSession.isLoading && !authSession.isError),
  });

  return <>{children}</>;
}

export function AppProviders({ children }: PropsWithChildren) {
  useEffect(() => {
    clearRetiredQueryCache();
    auditLocalStorageOnce();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthenticatedRuntime>{children}</AuthenticatedRuntime>
      </AuthProvider>
    </QueryClientProvider>
  );
}
