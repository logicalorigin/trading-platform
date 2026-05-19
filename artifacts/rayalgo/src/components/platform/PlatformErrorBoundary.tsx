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
  reportSeverity?: "info" | "warning" | "critical";
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
    severity?: "info" | "warning" | "critical";
    raw?: Record<string, unknown>;
  } = {},
) => {
  console.error("[rayalgo] UI boundary caught render error", {
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
  const actionStyle = {
    border: "1px solid color-mix(in srgb, currentColor 28%, transparent)",
    background: "Canvas",
    color: "CanvasText",
    cursor: "pointer",
    font: `700 ${TYPE_CSS_VAR.label} ${FONT_CSS_VAR.code}`,
    padding: "6px 10px",
  } as const;

  return (
    <div
      role="status"
      data-testid={`platform-error-boundary-${label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")}`}
      style={{
        minHeight: minHeight ?? 180,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 16,
        border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
        background: "color-mix(in srgb, Canvas 94%, currentColor 6%)",
        color: "CanvasText",
        fontFamily: FONT_CSS_VAR.code,
        fontSize: TYPE_CSS_VAR.label,
        textAlign: "center",
      }}
    >
      <div style={{ fontWeight: FONT_WEIGHT.emphasis }}>{label} unavailable</div>
      <div
        style={{
          maxWidth: 420,
          opacity: 0.72,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {normalizedError.message || "Render failed."}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: 8,
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
