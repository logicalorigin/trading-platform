import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ErrorBoundary,
  type FallbackProps,
} from "react-error-boundary";
import {
  buildRootCrashDiagnosticBundle,
  openDiagnosticsScreen,
  redactCrashDiagnosticValue,
} from "../../app/crashDiagnostics";
import { FONT_CSS_VAR, FONT_WEIGHT, TYPE_CSS_VAR } from "../../lib/typography";

type PlatformErrorBoundaryProps = {
  children: ReactNode;
  label: string;
  resetKeys?: unknown[];
  minHeight?: number | string;
  onReset?: () => void;
  reportCategory?: string;
  reportSeverity?: "info" | "warning";
  buildReportRaw?: (details: {
    label: string;
    error: Error;
    info: ErrorInfo;
  }) => Record<string, unknown>;
  onBoundaryError?: (details: {
    label: string;
    error: Error;
    info: ErrorInfo;
  }) => void;
  fallbackRender?: (
    props: FallbackProps & {
      label: string;
      normalizedError: Error;
      minHeight?: number | string;
      componentStack?: string | null;
    },
  ) => ReactNode;
  autoResetDelaysMs?: number[];
  onAutoReset?: (details: {
    label: string;
    attempt: number;
    error: Error;
  }) => void;
};

const reportPlatformBoundaryError = (
  label: string,
  error: Error,
  info: ErrorInfo,
  options: {
    category?: string;
    severity?: "info" | "warning";
    raw?: Record<string, unknown>;
  } = {},
) => {
  console.error("[pyrus] UI boundary caught render error", {
    label,
    error,
    componentStack: info.componentStack,
  });

  if (typeof fetch !== "function") {
    return;
  }

  fetch("/api/diagnostics/client-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      category: options.category ?? "react-error-boundary",
      severity: options.severity ?? "warning",
      code: label.slice(0, 96),
      message: error.message || "Render boundary error",
      raw: options.raw ?? {
        label,
        name: error.name,
        componentStack: info.componentStack,
      },
    }),
  }).catch(() => {});
};

const normalizeBoundaryError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error || "Render failed."));

const SIGNATURE_MAX_LENGTH = 72;

// Compact, URL-free hint for the fallback headline. Dynamic-import failures put
// the full chunk URL in error.message ("Failed to fetch dynamically imported
// module: https://…/assets/[chunk]-[hash].js"); surfacing it verbatim leaks
// build internals into user-facing copy. Strip any scheme / protocol-relative
// URL and keep a short reason keyed off the error name. Full detail (message +
// component stack) stays available in the collapsed diagnostic section below.
// Also consumed by screenRegistry's screen-load fallback for the same reason.
export const summarizeErrorSignature = (error: Error): string => {
  const name = (error.name || "Error").trim();
  const firstLine = String(error.message || "").split("\n", 1)[0] ?? "";
  const withoutUrls = firstLine
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "")
    .replace(/\/\/\S+/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[\s:]+$/, "")
    .trim();
  const detail =
    withoutUrls && withoutUrls.toLowerCase() !== name.toLowerCase()
      ? `${name}: ${withoutUrls}`
      : name;
  return detail.length > SIGNATURE_MAX_LENGTH
    ? `${detail.slice(0, SIGNATURE_MAX_LENGTH - 1)}…`
    : detail;
};

function WidgetErrorFallback({
  error,
  label,
  minHeight,
  resetErrorBoundary,
  autoResetAttemptRef,
  autoResetDelaysMs,
  onAutoReset,
  markNextResetAutomatic,
  componentStack,
}: FallbackProps & {
  label: string;
  minHeight?: number | string;
  autoResetAttemptRef: MutableRefObject<number>;
  autoResetDelaysMs?: number[];
  onAutoReset?: PlatformErrorBoundaryProps["onAutoReset"];
  markNextResetAutomatic: () => void;
  componentStack?: string | null;
}) {
  const normalizedError = normalizeBoundaryError(error);
  const [copyLabel, setCopyLabel] = useState("Copy bundle");
  const autoResetDelayMs =
    autoResetDelaysMs?.[autoResetAttemptRef.current] ?? null;
  const bundleText = useMemo(
    () =>
      JSON.stringify(
        redactCrashDiagnosticValue(
          buildRootCrashDiagnosticBundle({
            label,
            error: normalizedError,
            componentStack,
          }),
        ),
        null,
        2,
      ),
    [componentStack, label, normalizedError],
  );

  useEffect(() => {
    if (!Number.isFinite(autoResetDelayMs) || Number(autoResetDelayMs) < 0) {
      return undefined;
    }

    const timer = setTimeout(() => {
      const nextAttempt = autoResetAttemptRef.current + 1;
      autoResetAttemptRef.current = nextAttempt;
      onAutoReset?.({
        label,
        attempt: nextAttempt,
        error: normalizedError,
      });
      markNextResetAutomatic();
      resetErrorBoundary();
    }, Number(autoResetDelayMs));

    return () => clearTimeout(timer);
  }, [
    autoResetAttemptRef,
    autoResetDelayMs,
    label,
    markNextResetAutomatic,
    normalizedError,
    onAutoReset,
    resetErrorBoundary,
  ]);

  const handleManualRetry = () => {
    autoResetAttemptRef.current = 0;
    resetErrorBoundary();
  };
  const handleCopyBundle = async () => {
    try {
      await navigator.clipboard.writeText(bundleText);
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy failed");
    }
  };
  const signature = summarizeErrorSignature(normalizedError);
  // Hairline + semantic tone tokens with light-theme fallbacks (mirrors the
  // sibling screen-load fallback in screenRegistry.jsx). This fallback only
  // renders inside the themed app, so the --ra-* tokens resolve; the fallbacks
  // are belt-and-suspenders for a token-less render.
  const hairline =
    "1px solid color-mix(in srgb, var(--ra-border-default, #C7D0DE) 68%, transparent)";
  const textSecondary = "var(--ra-text-secondary, #4B5563)";
  const textMuted = "var(--ra-text-muted, #6B7280)";
  const toneAccent = "var(--ra-amber-500, #C28526)";
  const actionStyle = {
    border: hairline,
    background: "var(--ra-surface-0, #FFFFFF)",
    color: "var(--ra-text-primary, #101827)",
    cursor: "pointer",
    font: `${FONT_WEIGHT.label} ${TYPE_CSS_VAR.label} ${FONT_CSS_VAR.code}`,
    padding: "6px 12px",
    borderRadius: 4,
  } as const;

  return (
    <div
      role="status"
      data-testid={`platform-error-boundary-${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`}
      style={{
        minHeight: minHeight ?? 180,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
          border: hairline,
          borderLeft: `2px solid ${toneAccent}`,
          borderRadius: 8,
          background: "var(--ra-surface-1, #F5F8FD)",
          color: "var(--ra-text-primary, #101827)",
          fontFamily: FONT_CSS_VAR.sans,
          fontSize: TYPE_CSS_VAR.body,
          textAlign: "left",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: toneAccent,
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontWeight: FONT_WEIGHT.emphasis,
              fontSize: TYPE_CSS_VAR.bodyStrong,
            }}
          >
            {label} unavailable
          </span>
        </div>
        <div style={{ color: textSecondary, lineHeight: 1.5 }}>
          This section stopped responding while loading. Retry to reload it, or
          copy the diagnostic bundle for support.
        </div>
        <code
          style={{
            alignSelf: "flex-start",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: FONT_CSS_VAR.code,
            fontSize: TYPE_CSS_VAR.label,
            color: textMuted,
            background: "var(--ra-surface-2, #E9EEF6)",
            border: hairline,
            borderRadius: 4,
            padding: "3px 8px",
          }}
        >
          {signature}
        </code>
        <details style={{ color: textMuted }}>
          <summary
            style={{
              cursor: "pointer",
              color: textSecondary,
              fontSize: TYPE_CSS_VAR.label,
            }}
          >
            Diagnostic detail
          </summary>
          <pre
            style={{
              margin: "8px 0 0",
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              fontFamily: FONT_CSS_VAR.code,
              fontSize: TYPE_CSS_VAR.micro,
              lineHeight: 1.5,
              color: textMuted,
            }}
          >
            {`${normalizedError.message || "Render failed."}${
              componentStack ? `\n\n${componentStack}` : ""
            }`}
          </pre>
        </details>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 2,
          }}
        >
          <button type="button" onClick={handleManualRetry} style={actionStyle}>
            Retry
          </button>
          <button type="button" onClick={openDiagnosticsScreen} style={actionStyle}>
            Open Diagnostics
          </button>
          <button type="button" onClick={handleCopyBundle} style={actionStyle}>
            {copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function PlatformErrorBoundary({
  children,
  label,
  resetKeys = [],
  minHeight,
  onReset,
  autoResetDelaysMs,
  onAutoReset,
  reportCategory,
  reportSeverity,
  buildReportRaw,
  onBoundaryError,
  fallbackRender,
}: PlatformErrorBoundaryProps) {
  const autoResetAttemptRef = useRef(0);
  const nextResetIsAutomaticRef = useRef(false);
  const lastErrorInfoRef = useRef<ErrorInfo | null>(null);
  const markNextResetAutomatic = () => {
    nextResetIsAutomaticRef.current = true;
  };
  const handleReset = () => {
    if (nextResetIsAutomaticRef.current) {
      nextResetIsAutomaticRef.current = false;
      return;
    }
    autoResetAttemptRef.current = 0;
    onReset?.();
  };

  return (
    <ErrorBoundary
      resetKeys={resetKeys}
      onError={(error, info) => {
        const normalizedError = normalizeBoundaryError(error);
        lastErrorInfoRef.current = info;
        onBoundaryError?.({ label, error: normalizedError, info });
        let raw: Record<string, unknown> | undefined;
        try {
          raw = buildReportRaw?.({ label, error: normalizedError, info });
        } catch {}
        reportPlatformBoundaryError(label, normalizedError, info, {
          category: reportCategory,
          severity: reportSeverity,
          raw,
        });
      }}
      onReset={handleReset}
      fallbackRender={(props) => {
        const normalizedError = normalizeBoundaryError(props.error);
        if (fallbackRender) {
          return fallbackRender({
            ...props,
            label,
            normalizedError,
            minHeight,
            componentStack: lastErrorInfoRef.current?.componentStack ?? null,
          });
        }
        return (
          <WidgetErrorFallback
            {...props}
            label={label}
            minHeight={minHeight}
            autoResetAttemptRef={autoResetAttemptRef}
            autoResetDelaysMs={autoResetDelaysMs}
            onAutoReset={onAutoReset}
            markNextResetAutomatic={markNextResetAutomatic}
            componentStack={lastErrorInfoRef.current?.componentStack ?? null}
          />
        );
      }}
    >
      {children}
    </ErrorBoundary>
  );
}
