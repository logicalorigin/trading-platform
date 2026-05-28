import React, { useEffect, useMemo, useState } from "react";
import type { ErrorInfo } from "react";
import { Activity, AlertTriangle, Copy, RefreshCcw } from "lucide-react";
import type { FallbackProps } from "react-error-boundary";
import {
  buildPyrusRuntimeFingerprint,
  type PyrusRuntimeFingerprint,
} from "./runtimeDiagnostics";
import { FONT_CSS_VAR } from "../lib/typography";

const PYRUS_STORAGE_KEY = "pyrus:state:v1";
const LAST_CRASH_KEY = "pyrus:last-crash-diagnostics:v1";
const RECENT_BROWSER_EVENTS_KEY = "pyrus:recent-browser-diagnostics:v1";
const MAX_RECENT_BROWSER_EVENTS = 8;
const MAX_STRING_LENGTH = 1_500;
const MAX_ARRAY_ITEMS = 12;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;

type BrowserDiagnosticEvent = {
  at?: string;
  category: string;
  severity: "info" | "warning" | "critical";
  code?: string | null;
  message: string;
  raw?: Record<string, unknown>;
};

export type RootCrashDiagnosticBundle = {
  kind: "pyrus-root-crash";
  capturedAt: string;
  label: string;
  error: {
    name: string;
    message: string;
    stack: string | null;
  };
  componentStack: string | null;
  route: string;
  userAgent: string;
  runtime: PyrusRuntimeFingerprint;
  recentBrowserEvents: unknown[];
};

type LatestDiagnosticsSummary = {
  timestamp?: string;
  status?: string;
  severity?: string;
  summary?: string;
  snapshots?: Array<{
    subsystem?: string;
    status?: string;
    severity?: string;
    summary?: string;
  }>;
};

const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|password|secret|token|account|accountid|selectedaccount|credential|apiKey|session)/i;

const readSessionJson = (key: string): unknown => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return null;
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const writeSessionJson = (key: string, value: unknown) => {
  try {
    if (typeof window === "undefined" || !window.sessionStorage) return;
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const normalizeError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error || "Unknown error"));

const redactString = (value: string): string => {
  const withoutAccountIds = value.replace(/\bU\d{4,}\b/g, "U***");
  const withoutCredentials = withoutAccountIds.replace(
    /([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
    "$1[redacted]@",
  );
  const withoutQuerySecrets = withoutCredentials.replace(
    /([?&](?:token|secret|password|api_key|apikey|authorization)=)[^&\s]+/gi,
    "$1[redacted]",
  );
  return withoutQuerySecrets.length > MAX_STRING_LENGTH
    ? `${withoutQuerySecrets.slice(0, MAX_STRING_LENGTH)}...`
    : withoutQuerySecrets;
};

export const redactCrashDiagnosticValue = (
  value: unknown,
  key = "",
  depth = 0,
): unknown => {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    return "[redacted]";
  }
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return redactString(value);
  }
  if (depth >= MAX_DEPTH) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((entry) => redactCrashDiagnosticValue(entry, key, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([entryKey, entryValue]) => [
          entryKey,
          redactCrashDiagnosticValue(entryValue, entryKey, depth + 1),
        ]),
    );
  }
  return String(value);
};

const readRecentBrowserEvents = (): unknown[] => {
  const value = readSessionJson(RECENT_BROWSER_EVENTS_KEY);
  return Array.isArray(value) ? value : [];
};

export const rememberBrowserDiagnosticEvent = (event: BrowserDiagnosticEvent) => {
  const recent = readRecentBrowserEvents();
  const next = [
    redactCrashDiagnosticValue({ at: event.at ?? new Date().toISOString(), ...event }),
    ...recent,
  ].slice(0, MAX_RECENT_BROWSER_EVENTS);
  writeSessionJson(RECENT_BROWSER_EVENTS_KEY, next);
};

export const buildRootCrashDiagnosticBundle = ({
  label,
  error,
  componentStack,
}: {
  label: string;
  error: unknown;
  componentStack?: string | null;
}): RootCrashDiagnosticBundle => {
  const normalizedError = normalizeError(error);
  return {
    kind: "pyrus-root-crash",
    capturedAt: new Date().toISOString(),
    label,
    error: {
      name: normalizedError.name || "Error",
      message: normalizedError.message || "Root render failed",
      stack: normalizedError.stack || null,
    },
    componentStack: componentStack || null,
    route: typeof window === "undefined" ? "" : window.location.href,
    userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
    runtime: buildPyrusRuntimeFingerprint(),
    recentBrowserEvents: readRecentBrowserEvents(),
  };
};

export const rememberRootCrashDiagnostic = ({
  label,
  error,
  info,
}: {
  label: string;
  error: Error;
  info: ErrorInfo;
}) => {
  writeSessionJson(
    LAST_CRASH_KEY,
    redactCrashDiagnosticValue(
      buildRootCrashDiagnosticBundle({
        label,
        error,
        componentStack: info.componentStack,
      }),
    ),
  );
};

export const buildRootCrashReportRaw = ({
  label,
  error,
  info,
}: {
  label: string;
  error: Error;
  info: ErrorInfo;
}) =>
  redactCrashDiagnosticValue(
    buildRootCrashDiagnosticBundle({
      label,
      error,
      componentStack: info.componentStack,
    }),
  ) as Record<string, unknown>;

const loadLatestDiagnostics = async (): Promise<LatestDiagnosticsSummary | null> => {
  const response = await fetch("/api/diagnostics/latest", {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return null;
  const body = (await response.json()) as LatestDiagnosticsSummary;
  return {
    timestamp: body.timestamp,
    status: body.status,
    severity: body.severity,
    summary: body.summary,
    snapshots: Array.isArray(body.snapshots)
      ? body.snapshots.slice(0, 8).map((snapshot) => ({
          subsystem: snapshot?.subsystem,
          status: snapshot?.status,
          severity: snapshot?.severity,
          summary: snapshot?.summary,
        }))
      : [],
  };
};

export const openDiagnosticsScreen = () => {
  try {
    const raw =
      window.localStorage?.getItem(PYRUS_STORAGE_KEY) ??
      window.localStorage?.getItem(PYRUS_STORAGE_KEY);
    const state = raw ? JSON.parse(raw) : {};
    window.localStorage?.setItem(
      PYRUS_STORAGE_KEY,
      JSON.stringify({ ...state, screen: "diagnostics" }),
    );
  } catch {}
  window.location.assign(window.location.pathname || "/");
};

const buttonStyle = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  minHeight: 34,
  border: "1px solid rgba(232, 229, 222, 0.24)",
  background: "#232227",
  color: "#F2EFE9",
  padding: "7px 11px",
  fontFamily: FONT_CSS_VAR.sans,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
} as const;

export function RootCrashDiagnosticsFallback({
  error,
  normalizedError,
  label,
  componentStack,
  resetErrorBoundary,
}: FallbackProps & {
  label: string;
  normalizedError?: Error;
  componentStack?: string | null;
}) {
  const [latestDiagnostics, setLatestDiagnostics] =
    useState<LatestDiagnosticsSummary | null>(null);
  const [copyLabel, setCopyLabel] = useState("Copy bundle");
  const normalized = normalizedError ?? normalizeError(error);
  const bundle = useMemo(
    () =>
      redactCrashDiagnosticValue(
        buildRootCrashDiagnosticBundle({
          label,
          error: normalized,
          componentStack,
        }),
      ) as RootCrashDiagnosticBundle,
    [componentStack, label, normalized],
  );
  const displayBundle = useMemo(
    () =>
      redactCrashDiagnosticValue({
        ...bundle,
        latestDiagnostics,
      }),
    [bundle, latestDiagnostics],
  );
  const bundleText = useMemo(
    () => JSON.stringify(displayBundle, null, 2),
    [displayBundle],
  );

  useEffect(() => {
    let cancelled = false;
    loadLatestDiagnostics()
      .then((summary) => {
        if (!cancelled) setLatestDiagnostics(summary);
      })
      .catch(() => {
        if (!cancelled) setLatestDiagnostics(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bundleText);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy failed");
    }
  };

  return (
    <main
      data-testid="root-crash-diagnostics"
      style={{
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: 24,
        background: "#16151A",
        color: "#F2EFE9",
        fontFamily: FONT_CSS_VAR.sans,
      }}
    >
      <section
        style={{
          maxWidth: 1180,
          margin: "0 auto",
          display: "grid",
          gap: 16,
        }}
      >
        <header style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <img
              src="/brand/pyrus-mark-dark.svg"
              alt=""
              style={{ height: 42, width: 42, objectFit: "contain" }}
            />
            <img
              src="/brand/pyrus-wordmark-tight.png"
              alt="PYRUS"
              style={{ height: 28, width: "auto", objectFit: "contain" }}
            />
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "#D9A864",
              fontSize: 12,
              fontWeight: 700,
              textTransform: "uppercase",
            }}
          >
            <AlertTriangle size={18} aria-hidden="true" />
            PYRUS ROOT CRASH
          </div>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.15 }}>
            {bundle.error.message || "Render failed"}
          </h1>
          <div style={{ color: "#B8B4AC", fontSize: 12 }}>
            {bundle.runtime.buildMode} / {bundle.runtime.gitSha} /{" "}
            {bundle.runtime.sourceTreeStatus}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button type="button" onClick={resetErrorBoundary} style={buttonStyle}>
              <RefreshCcw size={15} aria-hidden="true" />
              Retry
            </button>
            <button type="button" onClick={openDiagnosticsScreen} style={buttonStyle}>
              <Activity size={15} aria-hidden="true" />
              Open Diagnostics
            </button>
            <button type="button" onClick={handleCopy} style={buttonStyle}>
              <Copy size={15} aria-hidden="true" />
              {copyLabel}
            </button>
          </div>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ border: "1px solid #2F2E35", padding: 14 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 13 }}>Crash</h2>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#B8B4AC", fontSize: 11 }}>
              {bundle.error.stack || bundle.error.message}
            </pre>
          </div>
          <div style={{ border: "1px solid #2F2E35", padding: 14 }}>
            <h2 style={{ margin: "0 0 8px", fontSize: 13 }}>Diagnostics</h2>
            <dl style={{ margin: 0, display: "grid", gap: 6, fontSize: 12 }}>
              <div>Status: {latestDiagnostics?.status || "loading"}</div>
              <div>Severity: {latestDiagnostics?.severity || "unknown"}</div>
              <div>Summary: {latestDiagnostics?.summary || "not available"}</div>
            </dl>
          </div>
        </section>

        <section style={{ border: "1px solid #2F2E35", padding: 14 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 13 }}>Redacted Bundle</h2>
          <pre
            data-testid="root-crash-diagnostics-bundle"
            style={{
              maxHeight: 360,
              overflow: "auto",
              margin: 0,
              whiteSpace: "pre-wrap",
              color: "#B8B4AC",
              fontSize: 11,
              lineHeight: 1.45,
            }}
          >
            {bundleText}
          </pre>
        </section>
      </section>
    </main>
  );
}
