import { useCallback, useEffect, useRef, useState } from "react";

import { getAccounts, getMarketBars, getMarketOrderFlow, getSpotQuote } from "../lib/brokerClient.js";
import { isConnectedAccount, isMarketDataReadyAccount } from "../lib/accountStatus.js";
import { clearRuntimeActivity, upsertRuntimeActivity } from "../lib/runtimeDiagnostics.js";

const C = {
  bg: "#ffffff",
  border: "#d6e0ea",
  text: "#0f172a",
  muted: "#64748b",
  red: "#ef4444",
  green: "#10b981",
  amber: "#f59e0b",
};

function buildLiveWiringMessage(state, symbol, compact) {
  if (state.loading) {
    return compact ? "Checking market wiring..." : "Live wiring: checking...";
  }
  if (state.error) {
    return compact ? state.error : `Live wiring: ${state.error}`;
  }
  const quoteLast = Number(state.quote?.last);
  const quoteText = Number.isFinite(quoteLast) ? `${quoteLast.toFixed(2)}` : "--";
  const body = `${state.accountLabel} · ${symbol} ${quoteText} · quote ${state.quoteSource || "unknown"} · bars ${state.barsCount} (${state.barsSource || "unknown"}) · flow ${state.flowScore == null ? "--" : Number(state.flowScore).toFixed(2)} (${state.flowSource || "unknown"})`;
  return compact ? body : `Live wiring: ${body}`;
}

export default function LiveWiringBanner({
  symbol = "SPY",
  marginBottom = 10,
  showRefresh = false,
  compact = false,
  enabled = true,
  diagnosticsId = "live-wiring",
  diagnosticsSurface = null,
  diagnosticsLabel = "Live wiring banner",
}) {
  const [state, setState] = useState({
    loading: true,
    error: null,
    accountLabel: null,
    quote: null,
    quoteSource: null,
    barsCount: 0,
    barsSource: null,
    flowScore: null,
    flowSource: null,
  });
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (inFlightRef.current) {
      return;
    }
    inFlightRef.current = true;
    try {
      const accounts = await getAccounts();
      if (!accounts.length) {
        setState({
          loading: false,
          error: "No accounts configured",
          accountLabel: null,
          quote: null,
          quoteSource: null,
          barsCount: 0,
          barsSource: null,
          flowScore: null,
          flowSource: null,
        });
        return;
      }

      const selected = accounts.find((account) => isMarketDataReadyAccount(account)) || null;
      if (!selected) {
        const fallbackAccount = accounts.find((account) => isConnectedAccount(account)) || accounts[0] || null;
        setState({
          loading: false,
          error: "Waiting for verified broker market data",
          accountLabel: fallbackAccount?.label || null,
          quote: null,
          quoteSource: null,
          barsCount: 0,
          barsSource: null,
          flowScore: null,
          flowSource: null,
        });
        return;
      }
      const [quoteResult, barsResult, flowResult] = await Promise.all([
        getSpotQuote({ accountId: selected.accountId, symbol })
          .then((quote) => ({ quote, error: null }))
          .catch((error) => ({ quote: null, error })),
        getMarketBars({ accountId: selected.accountId, symbol, resolution: "5", countBack: 5 })
          .then((bars) => ({ bars, error: null }))
          .catch((error) => ({ bars: null, error })),
        getMarketOrderFlow({ accountId: selected.accountId, symbol, resolution: "5", countBack: 30 })
          .then((orderFlow) => ({ orderFlow, error: null }))
          .catch((error) => ({ orderFlow: null, error })),
      ]);

      const quote = quoteResult.quote;
      const bars = barsResult.bars;
      const orderFlow = flowResult.orderFlow;
      const wireError =
        quoteResult.error && barsResult.error && flowResult.error
          ? normalizeLiveWiringError(quoteResult.error)
          : null;

      setState({
        loading: false,
        error: wireError,
        accountLabel: selected.label,
        quote,
        quoteSource: quote?.source || null,
        barsCount: Array.isArray(bars?.bars) ? bars.bars.length : 0,
        barsSource: bars?.source || null,
        flowScore: Number.isFinite(Number(orderFlow?.score)) ? Number(orderFlow.score) : null,
        flowSource: orderFlow?.source || null,
      });
    } catch (error) {
      setState({
        loading: false,
        error: normalizeLiveWiringError(error),
        accountLabel: null,
        quote: null,
        quoteSource: null,
        barsCount: 0,
        barsSource: null,
        flowScore: null,
        flowSource: null,
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, symbol]);

  useEffect(() => {
    const activityId = `poller.${String(diagnosticsId || "live-wiring").trim() || "live-wiring"}`;
    if (!enabled) {
      clearRuntimeActivity(activityId);
      return undefined;
    }
    upsertRuntimeActivity(activityId, {
      kind: "poller",
      label: diagnosticsLabel,
      surface: diagnosticsSurface,
      intervalMs: 15000,
      meta: {
        symbol,
        compact: Boolean(compact),
      },
    });
    return () => clearRuntimeActivity(activityId);
  }, [compact, diagnosticsId, diagnosticsLabel, diagnosticsSurface, enabled, symbol]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    refresh().catch(() => {});
    const timer = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  const message = buildLiveWiringMessage(state, symbol, compact);
  const statusTone = state.error ? C.red : state.loading ? C.amber : C.green;
  const showInlineRefresh = compact || showRefresh;

  return (
    <div
      style={{
        background: compact ? "#f8fafc" : C.bg,
        border: `1px solid ${compact ? "#e2e8f0" : C.border}`,
        borderRadius: compact ? 8 : 7,
        padding: compact ? "3px 6px" : "6px 9px",
        marginBottom,
        display: "flex",
        gap: compact ? 6 : 10,
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: compact ? "nowrap" : "wrap",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 0, flexWrap: compact ? "nowrap" : "wrap", minWidth: 0, flex: 1 }}>
        {compact ? (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "1px 6px",
              borderRadius: 999,
              background: "#ffffff",
              border: "1px solid #e2e8f0",
              fontSize: 10,
              fontWeight: 700,
              color: "#334155",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: statusTone, flexShrink: 0 }} />
            Live
          </div>
        ) : null}
        <div
          style={{
            fontSize: compact ? 10.5 : 12,
            color: state.error ? C.red : C.muted,
            minWidth: 0,
            overflow: compact ? "hidden" : "visible",
            textOverflow: compact ? "ellipsis" : "clip",
            whiteSpace: compact ? "nowrap" : "normal",
          }}
        >
          {message}
        </div>
      </div>
      {showInlineRefresh ? (
        <button
          onClick={() => refresh().catch(() => {})}
          disabled={!enabled}
          style={{
            border: `1px solid ${compact ? "#dbe2ea" : C.border}`,
            borderRadius: compact ? 999 : 5,
            padding: compact ? "2px 7px" : "3px 8px",
            cursor: enabled ? "pointer" : "not-allowed",
            background: "#ffffff",
            color: C.text,
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            whiteSpace: "nowrap",
            flexShrink: 0,
            opacity: enabled ? 1 : 0.45,
          }}
        >
          {state.loading ? "Checking" : "Refresh"}
        </button>
      ) : null}
    </div>
  );
}

function normalizeLiveWiringError(error) {
  const message = String(error?.message || "Live wiring check failed");
  const lower = message.toLowerCase();
  if (lower === "not found" || lower.includes(" not found")) {
    return "Live wiring API route unavailable. Restart dev server.";
  }
  if (lower.includes("account not found")) {
    return "No market account ready for SPY quote yet.";
  }
  return message;
}
