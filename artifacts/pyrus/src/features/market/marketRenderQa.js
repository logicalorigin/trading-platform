const MARKET_QA_ENABLED_VALUES = new Set(["1", "true", "render", "debug"]);
const MARKET_QA_OFF_VALUES = new Set(["0", "false", "off"]);
const MARKET_QA_FIXTURES = new Set(["live", "safe", "dense", "quiet", "empty"]);
const MARKET_QA_CHART_MODES = new Set(["live", "shell"]);
const MARKET_QA_DENSITIES = new Set(["standard", "stress", "empty"]);

const normalizeSearch = (search = "") => {
  const text = String(search || "");
  return text.startsWith("?") ? text.slice(1) : text;
};

const normalizeParam = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const pickAllowedParam = (value, allowed, fallback) => {
  const normalized = normalizeParam(value);
  return allowed.has(normalized) ? normalized : fallback;
};

export const resolveMarketRenderQaConfig = ({
  safeQaMode = false,
  search = "",
} = {}) => {
  const params = new URLSearchParams(normalizeSearch(search));
  const requestedMode = normalizeParam(params.get("pyrusMarketQa"));
  const queryEnabled =
    MARKET_QA_ENABLED_VALUES.has(requestedMode) &&
    !MARKET_QA_OFF_VALUES.has(requestedMode);

  if (safeQaMode) {
    return {
      enabled: true,
      source: "safe",
      fixture: "safe",
      chartMode: "shell",
      density: pickAllowedParam(
        params.get("pyrusMarketDensity"),
        MARKET_QA_DENSITIES,
        "standard",
      ),
    };
  }

  if (!queryEnabled) {
    return {
      enabled: false,
      source: "runtime",
      fixture: "live",
      chartMode: "live",
      density: "standard",
    };
  }

  return {
    enabled: true,
    source: "query",
    fixture: pickAllowedParam(
      params.get("pyrusMarketFixture"),
      MARKET_QA_FIXTURES,
      "live",
    ),
    chartMode: pickAllowedParam(
      params.get("pyrusMarketCharts"),
      MARKET_QA_CHART_MODES,
      "live",
    ),
    density: pickAllowedParam(
      params.get("pyrusMarketDensity"),
      MARKET_QA_DENSITIES,
      "standard",
    ),
  };
};

export const resolveMarketPanelColumns = (
  width,
  {
    desktop,
    tablet,
    phone,
    tabletMax = 1180,
    phoneMax = 640,
  },
) => {
  const numericWidth = Number(width);
  if (Number.isFinite(numericWidth) && numericWidth > 0) {
    if (numericWidth < phoneMax) {
      return phone;
    }
    if (numericWidth < tabletMax) {
      return tablet;
    }
  }

  return desktop;
};

export const resolveMarketViewportClass = (width) => {
  const numericWidth = Number(width);
  if (!Number.isFinite(numericWidth) || numericWidth <= 0) {
    return "unknown";
  }
  if (numericWidth < 640) {
    return "phone";
  }
  if (numericWidth < 1180) {
    return "tablet";
  }
  return "desktop";
};

const countValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? String(Math.round(number)) : "0";
};

export const buildMarketRenderDiagnostics = ({
  qaConfig,
  chartMode,
  workspaceWidth,
  pulseColumns,
  sectorFlowColumns,
  leadershipColumns,
  dataCounts = {},
} = {}) => {
  const config = qaConfig || resolveMarketRenderQaConfig();
  const width = Number(workspaceWidth);
  const normalizedWidth = Number.isFinite(width) && width > 0 ? Math.round(width) : 0;

  return {
    "data-market-qa-enabled": config.enabled ? "true" : "false",
    "data-market-qa-source": config.source,
    "data-market-fixture": config.fixture,
    "data-market-chart-mode": chartMode || config.chartMode,
    "data-market-density": config.density,
    "data-market-viewport": resolveMarketViewportClass(normalizedWidth),
    "data-market-workspace-width": String(normalizedWidth),
    "data-market-pulse-columns": countValue(pulseColumns),
    "data-market-sector-flow-columns": countValue(sectorFlowColumns),
    "data-market-leadership-columns": countValue(leadershipColumns),
    "data-market-news-count": countValue(dataCounts.news),
    "data-market-sector-flow-count": countValue(dataCounts.sectorFlow),
    "data-market-leaders-count": countValue(dataCounts.leaders),
    "data-market-laggards-count": countValue(dataCounts.laggards),
  };
};
