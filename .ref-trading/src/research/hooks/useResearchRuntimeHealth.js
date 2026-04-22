import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiHealth } from "../../lib/brokerClient.js";

const HEALTH_POLL_MS = 15000;

const OK_HEALTH = {
  status: "ok",
  source: null,
  label: null,
  title: null,
};

function buildHealthSignature(health) {
  return [
    String(health?.status || "ok"),
    String(health?.source || ""),
    String(health?.label || ""),
    String(health?.title || ""),
  ].join(":");
}

function normalizeHealth(input, fallbackSource = null) {
  const status = String(input?.status || "ok");
  if (status === "ok") {
    return OK_HEALTH;
  }
  const source = String(input?.source || fallbackSource || "").trim() || null;
  return {
    status: status === "error" ? "error" : "degraded",
    source,
    label: String(
      input?.label
      || (source === "chart"
        ? "Chart under load"
        : source === "server"
          ? "Server issue"
          : ""),
    ).trim() || null,
    title: String(input?.title || input?.message || "").trim() || null,
  };
}

function normalizeChartModelHealth(chartModelRuntime) {
  const status = String(chartModelRuntime?.status || "ok");
  if (status === "ok" || status === "idle") {
    return OK_HEALTH;
  }
  return {
    status: status === "error" ? "error" : "degraded",
    source: "chart",
    label: "Chart under load",
    title: String(
      chartModelRuntime?.message
      || (status === "error"
        ? "Chart model generation failed."
        : "Chart model generation is taking longer than normal."),
    ),
  };
}

function normalizeServerHealthPayload(payload) {
  if (!payload || payload.ok === false) {
    return {
      status: "error",
      source: "server",
      label: "Server issue",
      title: String(payload?.error || "Backtest server health is unavailable."),
    };
  }
  const warmStatus = payload?.researchSpotWarm || payload?.services?.researchSpotWarm || null;
  const warmState = String(warmStatus?.state || warmStatus?.status || "ok").trim().toLowerCase();
  if (!warmStatus || warmState === "ok" || warmState === "disabled" || warmState === "idle") {
    return OK_HEALTH;
  }
  return {
    status: warmState === "error" ? "error" : "degraded",
    source: "server",
    label: "Server issue",
    title: warmStatus?.message
      || warmStatus?.lastResult?.error
      || "Backtest background services are degraded.",
  };
}

function pickRuntimeHealth(serverHealth, chartHealth) {
  if (serverHealth.status === "error") {
    return serverHealth;
  }
  if (chartHealth.status === "error") {
    return chartHealth;
  }
  if (serverHealth.status === "degraded") {
    return serverHealth;
  }
  if (chartHealth.status === "degraded") {
    return chartHealth;
  }
  return OK_HEALTH;
}

function pickChartHealth(reportedChartHealth, chartModelHealth) {
  if (reportedChartHealth.status === "error") {
    return reportedChartHealth;
  }
  if (chartModelHealth.status === "error") {
    return chartModelHealth;
  }
  if (reportedChartHealth.status === "degraded") {
    return reportedChartHealth;
  }
  if (chartModelHealth.status === "degraded") {
    return chartModelHealth;
  }
  return OK_HEALTH;
}

export function useResearchRuntimeHealth({
  isActive = true,
  chartRuntime = null,
  chartModelRuntime = null,
} = {}) {
  const [serverHealth, setServerHealth] = useState(OK_HEALTH);
  const [reportedChartHealth, setReportedChartHealth] = useState(OK_HEALTH);

  const reportChartHealth = useCallback((nextHealth) => {
    const normalized = normalizeHealth(nextHealth, "chart");
    setReportedChartHealth((previous) => {
      if (buildHealthSignature(previous) === buildHealthSignature(normalized)) {
        return previous;
      }
      return normalized;
    });
  }, []);

  const refreshServerHealth = useCallback(async () => {
    try {
      const payload = await getApiHealth();
      const normalized = normalizeServerHealthPayload(payload);
      setServerHealth((previous) => {
        if (buildHealthSignature(previous) === buildHealthSignature(normalized)) {
          return previous;
        }
        return normalized;
      });
      return normalized;
    } catch (error) {
      const degraded = {
        status: "error",
        source: "server",
        label: "Server issue",
        title: error?.message || "Backtest server health is unavailable.",
      };
      setServerHealth((previous) => {
        if (buildHealthSignature(previous) === buildHealthSignature(degraded)) {
          return previous;
        }
        return degraded;
      });
      return degraded;
    }
  }, []);

  useEffect(() => {
    if (!isActive) {
      return undefined;
    }
    refreshServerHealth().catch(() => {});
    const timerId = setInterval(() => {
      refreshServerHealth().catch(() => {});
    }, HEALTH_POLL_MS);
    return () => clearInterval(timerId);
  }, [isActive, refreshServerHealth]);

  const chartHealth = useMemo(
    () => pickChartHealth(
      reportedChartHealth,
      pickChartHealth(
        normalizeHealth(chartRuntime, "chart"),
        normalizeChartModelHealth(chartModelRuntime),
      ),
    ),
    [chartModelRuntime, chartRuntime, reportedChartHealth],
  );
  const runtimeHealth = useMemo(
    () => pickRuntimeHealth(serverHealth, chartHealth),
    [chartHealth, serverHealth],
  );

  return {
    runtimeHealth,
    serverHealth,
    chartHealth,
    reportChartHealth,
    refreshServerHealth,
  };
}
