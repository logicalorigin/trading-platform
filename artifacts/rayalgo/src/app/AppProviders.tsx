import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type PropsWithChildren } from "react";
import { TooltipProvider } from "../components/ui/TooltipProvider";
import { useRayalgoPerformanceMetricsReporter } from "../features/platform/performanceMetrics";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
      gcTime: 10 * 60_000,
    },
  },
});

const LOCAL_STORAGE_WARN_BYTES = 2 * 1024 * 1024;
let storageAuditCompleted = false;

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
        `[rayalgo] localStorage holds ~${totalKb} KB across ${breakdown.length} keys. Top: ${top}`,
      );
    } else {
      console.info(
        `[rayalgo] localStorage audit: ~${totalKb} KB across ${breakdown.length} keys.`,
      );
    }
  } catch (error) {
    console.warn("[rayalgo] localStorage audit failed", error);
  }
};

export function AppProviders({ children }: PropsWithChildren) {
  useRayalgoPerformanceMetricsReporter();

  useEffect(() => {
    auditLocalStorageOnce();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={500} skipDelayDuration={150}>
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
