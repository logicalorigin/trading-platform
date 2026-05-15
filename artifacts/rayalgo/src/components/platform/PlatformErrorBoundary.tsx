import {
  useEffect,
  useRef,
  type ErrorInfo,
  type MutableRefObject,
  type ReactNode,
} from "react";
import {
  ErrorBoundary,
  type FallbackProps,
} from "react-error-boundary";
import { FONT_CSS_VAR, FONT_WEIGHT, TYPE_CSS_VAR } from "../../lib/typography";

type PlatformErrorBoundaryProps = {
  children: ReactNode;
  label: string;
  resetKeys?: unknown[];
  minHeight?: number | string;
  onReset?: () => void;
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
      category: "react-error-boundary",
      severity: "warning",
      code: label.slice(0, 96),
      message: error.message || "Render boundary error",
      raw: {
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
}: FallbackProps & {
  label: string;
  minHeight?: number | string;
  autoResetAttemptRef: MutableRefObject<number>;
  autoResetDelaysMs?: number[];
  onAutoReset?: PlatformErrorBoundaryProps["onAutoReset"];
  markNextResetAutomatic: () => void;
}) {
  const normalizedError = normalizeBoundaryError(error);
  const autoResetDelayMs =
    autoResetDelaysMs?.[autoResetAttemptRef.current] ?? null;

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
      <button
        type="button"
        onClick={handleManualRetry}
        style={{
          border: "1px solid color-mix(in srgb, currentColor 28%, transparent)",
          background: "Canvas",
          color: "CanvasText",
          cursor: "pointer",
          font: `700 ${TYPE_CSS_VAR.label} ${FONT_CSS_VAR.code}`,
          padding: "6px 10px",
        }}
      >
        Retry
      </button>
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
}: PlatformErrorBoundaryProps) {
  const autoResetAttemptRef = useRef(0);
  const nextResetIsAutomaticRef = useRef(false);
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
      onError={(error, info) =>
        reportPlatformBoundaryError(label, normalizeBoundaryError(error), info)
      }
      onReset={handleReset}
      fallbackRender={(props) => (
        <WidgetErrorFallback
          {...props}
          label={label}
          minHeight={minHeight}
          autoResetAttemptRef={autoResetAttemptRef}
          autoResetDelaysMs={autoResetDelaysMs}
          onAutoReset={onAutoReset}
          markNextResetAutomatic={markNextResetAutomatic}
        />
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
