import { Suspense, lazy, useEffect, type ComponentType } from "react";
import "./runtime-config";
import { AppProviders } from "./AppProviders";

const RayAlgoApp = lazy(async () => {
  const mod = await import("../features/platform/RayAlgoApp");

  return { default: mod.RayAlgoApp };
});

const ChartParityLab = lazy(async () => {
  const mod = await import("../features/charting");

  return { default: mod.ChartParityLab };
});

const TickerSearchLab = lazy(async () => {
  // @ts-expect-error legacy JSX module has no declaration file in this TS config
  const mod = (await import("../RayAlgoPlatform.jsx")) as {
    TickerSearchLab: ComponentType;
  };

  return { default: mod.TickerSearchLab };
});

const resolveLabMode = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  return new URLSearchParams(window.location.search).get("lab");
};

function postClientDiagnosticEvent(input: {
  category: string;
  severity: "info" | "warning" | "critical";
  code?: string | null;
  message: string;
  raw?: Record<string, unknown>;
}) {
  fetch("/api/diagnostics/client-events", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(input),
  }).catch(() => {});
}

function diagnosticErrorCode(
  filename: string | undefined,
  lineno: number | undefined,
  colno: number | undefined,
): string {
  const file = filename?.split("/").at(-1) || "unknown";
  return `${file}:${lineno ?? 0}:${colno ?? 0}`.slice(0, 96);
}

const APP_SHELL_TABS = [
  "Market",
  "Flow",
  "Trade",
  "Account",
  "Research",
  "Algo",
  "Backtest",
  "Diagnostics",
];

function AppLoadingFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        background: "#080b12",
        color: "#cbd5e1",
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      <style>
        {`
          @keyframes rayalgoAppPulse {
            0%, 100% { opacity: 0.46; }
            50% { opacity: 0.92; }
          }
          @keyframes rayalgoAppSlide {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
          }
        `}
      </style>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          alignItems: "center",
          gap: 8,
          minWidth: 0,
          minHeight: 41,
          padding: "4px 8px",
          background: "#101722",
          borderBottom: "1px solid #243042",
        }}
      >
        <div style={{ display: "flex", gap: 3, minWidth: 0, overflow: "hidden" }}>
          {APP_SHELL_TABS.map((tab, index) => (
            <div
              key={tab}
              style={{
                minHeight: 31,
                padding: "6px 8px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #263449",
                background: index === 0 ? "#182233" : "transparent",
                color: index === 0 ? "#e2e8f0" : "#94a3b8",
                fontSize: 10,
                fontWeight: 800,
                whiteSpace: "nowrap",
              }}
            >
              {tab}
            </div>
          ))}
        </div>
        <div
          style={{
            position: "relative",
            height: 24,
            overflow: "hidden",
            background: "#0b111b",
            border: "1px solid #1f2a3a",
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 0,
              width: "50%",
              background:
                "linear-gradient(90deg, transparent, rgba(56, 189, 248, 0.18), transparent)",
              animation: "rayalgoAppSlide 1.4s ease-in-out infinite",
            }}
          />
        </div>
        <div
          style={{
            display: "flex",
            gap: 5,
            alignItems: "center",
            color: "#94a3b8",
            fontSize: 10,
            fontWeight: 800,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              background: "#f59e0b",
              display: "inline-block",
              animation: "rayalgoAppPulse 1.1s ease-in-out infinite",
            }}
          />
          Starting
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "248px 1fr", minHeight: 0 }}>
        <div
          style={{
            borderRight: "1px solid #243042",
            background: "#0e1520",
            padding: 10,
            display: "grid",
            gap: 8,
            alignContent: "start",
          }}
        >
          {Array.from({ length: 12 }, (_, index) => (
            <div
              key={index}
              style={{
                height: 30,
                background: index === 0 ? "#172235" : "#111a28",
                border: "1px solid #1f2a3a",
                animation: `rayalgoAppPulse ${1.8 + index * 0.03}s ease-in-out infinite`,
              }}
            />
          ))}
        </div>
        <main
          style={{
            minWidth: 0,
            minHeight: 0,
            padding: 12,
            display: "grid",
            gridTemplateRows: "minmax(220px, 42vh) 1fr",
            gap: 10,
          }}
        >
          <section
            style={{
              position: "relative",
              overflow: "hidden",
              border: "1px solid #223047",
              background: "#0b111b",
            }}
          >
            <span
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.12), transparent)",
                animation: "rayalgoAppSlide 1.8s ease-in-out infinite",
              }}
            />
          </section>
          <section
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
              minHeight: 0,
            }}
          >
            {Array.from({ length: 3 }, (_, index) => (
              <div
                key={index}
                style={{
                  border: "1px solid #223047",
                  background: "#0d1420",
                  animation: `rayalgoAppPulse ${1.5 + index * 0.12}s ease-in-out infinite`,
                }}
              />
            ))}
          </section>
        </main>
      </div>

      <div
        style={{
          height: 24,
          borderTop: "1px solid #243042",
          background: "#101722",
          color: "#64748b",
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "0 12px",
          fontSize: 9,
          fontWeight: 800,
        }}
      >
        <span>RAYALGO</span>
        <span>LOADING PLATFORM SHELL</span>
      </div>
    </div>
  );
}

function App() {
  const labMode = resolveLabMode();

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const onError = (event: ErrorEvent) => {
      postClientDiagnosticEvent({
        category: "window-error",
        severity: "warning",
        code: diagnosticErrorCode(event.filename, event.lineno, event.colno),
        message: event.message || "Window error",
        raw: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);
      postClientDiagnosticEvent({
        category: "unhandled-rejection",
        severity: "warning",
        code:
          event.reason instanceof Error && event.reason.name
            ? event.reason.name.slice(0, 96)
            : "unhandled-rejection",
        message: reason || "Unhandled promise rejection",
        raw: { reason },
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return (
    <AppProviders>
      <Suspense fallback={<AppLoadingFallback />}>
        {labMode === "chart-parity" ? (
          <ChartParityLab />
        ) : labMode === "ticker-search" ? (
          <TickerSearchLab />
        ) : (
          <RayAlgoApp />
        )}
      </Suspense>
    </AppProviders>
  );
}

export default App;
