const SEVERITY_RANK = {
  info: 0,
  success: 0,
  neutral: 0,
  warning: 1,
  attention: 1,
  degraded: 1,
  down: 2,
};

const STATUS_TO_SEVERITY = {
  down: "warning",
  degraded: "warning",
  warning: "warning",
  high: "warning",
  watch: "warning",
  stale: "warning",
  blocked: "warning",
  error: "warning",
  fail: "warning",
  ok: "info",
  healthy: "info",
  normal: "info",
  ready: "info",
  info: "info",
};

const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi;
const SENSITIVE_HEADER_PATTERN =
  /^([ \t]*)((?:proxy-)?authorization|cookie|set-cookie|x-api-key)\s*:[^\r\n]*/gim;
const JSON_SECRET_PATTERN =
  /("[a-z0-9_-]*(?:token|secret|password|authorization|cookie|api[_-]?key)[a-z0-9_-]*"\s*:\s*)"(?:\\.|[^"\\])*"/gi;
const AUTH_TOKEN_PATTERN = /\b(bearer|basic)\s+[^\s,;)}]+/gi;
const JWT_PATTERN = /\b[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_PATTERN =
  /\b([a-z0-9_-]*(?:token|secret|password|authorization|cookie|api[_-]?key)[a-z0-9_-]*)(\s*[:=]\s*|\s+)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;)}]+)/gi;
const ACCOUNT_PATTERN = /\b(D?[UF])(\d{3,})(\d{2})\b/g;

const asRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const finiteNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const formatFailureLabel = (value) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const formatReason = (value) =>
  redactDiagnosticText(String(value || "").trim()).replace(/[_-]+/g, " ");

const normalizeSeverity = (value) => {
  const normalized = String(value || "").toLowerCase();
  return STATUS_TO_SEVERITY[normalized] || (SEVERITY_RANK[normalized] != null ? normalized : "info");
};

const maxSeverity = (...values) =>
  values.reduce((current, next) => {
    const normalized = normalizeSeverity(next);
    return (SEVERITY_RANK[normalized] ?? 0) > (SEVERITY_RANK[current] ?? 0)
      ? normalized
      : current;
  }, "info");

export const redactDiagnosticText = (value) => {
  const text = String(value ?? "");
  return text
    .replace(URL_PATTERN, "[url redacted]")
    .replace(SENSITIVE_HEADER_PATTERN, "$1$2: [redacted]")
    .replace(JSON_SECRET_PATTERN, '$1"[redacted]"')
    .replace(AUTH_TOKEN_PATTERN, "$1 [redacted]")
    .replace(SECRET_PATTERN, "$1$2[redacted]")
    .replace(JWT_PATTERN, "[token redacted]")
    .replace(ACCOUNT_PATTERN, (_match, prefix, middle, suffix) => {
      const visibleStart = `${prefix}${middle.slice(0, 1)}`;
      return `${visibleStart}...${suffix}`;
    });
};

const cleanText = (value) => {
  const text = redactDiagnosticText(String(value ?? "").trim());
  return text || null;
};

const compact = (values) =>
  values
    .flat()
    .map((value) => (typeof value === "string" ? cleanText(value) : value))
    .filter((value) => value !== null && value !== undefined && value !== "");

const formatCount = (value) => {
  const number = finiteNumber(value);
  return number === null ? null : Math.max(0, Math.round(number)).toLocaleString();
};

export const formatDuration = (value) => {
  const number = finiteNumber(value);
  if (number === null) return null;
  if (number >= 1000) {
    return `${(number / 1000).toFixed(number >= 10_000 ? 1 : 1)}s`;
  }
  return `${Math.round(number)}ms`;
};

const labelSubsystem = (value) => {
  const text = String(value || "").trim();
  if (!text) return "Diagnostics";
  if (text.toLowerCase() === "api") return "API";
  if (text.toLowerCase() === "ibkr") return "IBKR";
  return formatFailureLabel(text);
};

const metric = (label, value) => {
  const cleaned = cleanText(value);
  return cleaned ? [label, cleaned] : null;
};

const metricRows = (rows) => rows.filter(Boolean);

const routeCause = (label, route, detail) => {
  const routeText = cleanText(route);
  if (!routeText) return null;
  const detailText = cleanText(detail);
  return detailText ? `${label}: ${routeText} (${detailText})` : `${label}: ${routeText}`;
};

const driverCause = (driver) => {
  const record = asRecord(driver);
  const label = cleanText(record.label || record.kind);
  if (!label) return null;
  const detail = cleanText(record.detail);
  const level = cleanText(record.level);
  return compact([label, detail, level ? `level ${level}` : null]).join(" / ");
};

const defaultNextAction = (source, severity) => {
  if (source === "api") return "Inspect the slow and error routes in Diagnostics, then shed or defer the heaviest read path.";
  if (source === "orders") return "Retry order visibility after the bridge responds, then clear stale order-read suppression if it remains degraded.";
  if (source === "ibkr") return "Check bridge readiness, stream freshness, and lane pressure before changing trading state.";
  if (source === "resource-pressure") return "Inspect dominant pressure drivers and pause background hydration if latency stays elevated.";
  if (source === "automation") return "Inspect the Signal Options worker phase, latest scan duration, and stale dashboard cache.";
  if (severity === "warning") return "Review the related diagnostics panel before taking action.";
  return "No action required unless the state changes.";
};

export const buildFailurePoint = ({
  severity = "info",
  title,
  summary,
  source,
  reason,
  observedAt,
  metrics = [],
  topCauses = [],
  nextAction,
} = {}) => {
  const normalizedSeverity = normalizeSeverity(severity);
  const normalizedSource = cleanText(source) || "diagnostics";
  const normalizedReason = reason ? formatReason(reason) : null;
  const cleanedMetrics = metrics
    .map((row) => {
      if (!Array.isArray(row)) return null;
      const label = cleanText(row[0]);
      const value = cleanText(row[1]);
      return label && value ? [label, value] : null;
    })
    .filter(Boolean)
    .slice(0, 6);
  const cleanedCauses = compact(topCauses).slice(0, 5);
  return {
    severity: normalizedSeverity,
    title:
      cleanText(title) ||
      `${labelSubsystem(normalizedSource)} ${formatFailureLabel(normalizedSeverity)}`,
    summary:
      cleanText(summary) ||
      cleanedCauses[0] ||
      normalizedReason ||
      "No active failure detail is available yet.",
    source: normalizedSource,
    reason: normalizedReason,
    observedAt: cleanText(observedAt),
    metrics: cleanedMetrics,
    topCauses: cleanedCauses,
    nextAction: cleanText(nextAction) || defaultNextAction(normalizedSource, normalizedSeverity),
  };
};

export const buildFailurePointFromDiagnosticsSnapshot = (snapshot) => {
  const record = asRecord(snapshot);
  const metrics = asRecord(record.metrics);
  const source = String(record.subsystem || "diagnostics");
  const severity = maxSeverity(record.severity, record.status);
  const slowRouteDetail = formatDuration(metrics.dominantSlowRouteP95Ms);
  const errorCount = formatCount(metrics.dominantErrorRouteCount);
  const p95 = formatDuration(metrics.p95LatencyMs ?? metrics.p95_latency_ms);
  const p99 = formatDuration(metrics.p99LatencyMs);
  const pressure = cleanText(metrics.pressureLevel || metrics.effectivePressureLevel);
  const topSlowRoute = Array.isArray(metrics.slowRoutes) ? metrics.slowRoutes[0] : null;
  const topErrorRoute = Array.isArray(metrics.errorRoutes) ? metrics.errorRoutes[0] : null;
  const dominantDrivers = Array.isArray(metrics.dominantDrivers)
    ? metrics.dominantDrivers
    : [];
  const reason =
    record.degradedReason ||
    metrics.degradedReason ||
    asRecord(record.raw).reason ||
    record.status;

  return buildFailurePoint({
    severity,
    title: `${labelSubsystem(source)} ${formatFailureLabel(record.status || severity)}`,
    summary: record.summary,
    source,
    reason,
    observedAt: record.observedAt || record.timestamp,
    metrics: metricRows([
      metric("p95", p95),
      metric("p99", p99),
      metric("Errors / 5m", formatCount(metrics.errorCount5m)),
      metric("Warnings / 5m", formatCount(metrics.warningCount5m)),
      metric("Pressure", pressure?.toUpperCase()),
      metric("Status", formatFailureLabel(record.status || severity)),
    ]),
    topCauses: compact([
      routeCause("Slow route", metrics.dominantSlowRoute, slowRouteDetail),
      routeCause(
        "Error route",
        metrics.dominantErrorRoute,
        errorCount ? `${errorCount} errors` : null,
      ),
      topSlowRoute
        ? routeCause(
            "Top slow",
            asRecord(topSlowRoute).path,
            formatDuration(asRecord(topSlowRoute).p95LatencyMs),
          )
        : null,
      topErrorRoute
        ? routeCause(
            "Top error",
            asRecord(topErrorRoute).path,
            `${formatCount(asRecord(topErrorRoute).errorCount5m)} errors`,
          )
        : null,
      dominantDrivers.map(driverCause),
    ]),
    nextAction: defaultNextAction(source, severity),
  });
};

export const buildFailurePointFromDiagnosticEvent = (event) => {
  const record = asRecord(event);
  const severity = normalizeSeverity(record.severity);
  const reason = record.code || record.reason || record.category || record.kind;
  return buildFailurePoint({
    severity,
    title: record.message || record.title || formatFailureLabel(reason),
    summary: record.message || record.summary,
    source: record.subsystem || "diagnostics",
    reason,
    observedAt: record.lastSeenAt || record.observedAt || record.at || record.timestamp,
    metrics: metricRows([
      metric("Subsystem", record.subsystem),
      metric("Category", record.category || record.kind),
      metric("Repeats", formatCount(record.eventCount ?? record.repeatCount ?? record.count)),
    ]),
    topCauses: compact([
      record.code ? `Code: ${formatReason(record.code)}` : null,
      record.incidentKey ? `Incident: ${record.incidentKey}` : null,
    ]),
    nextAction: "Open the event detail in Diagnostics and compare it with the latest subsystem snapshot.",
  });
};

const attentionLabel = (item) => {
  const record = asRecord(item);
  return compact([
    record.kindLabel || record.kind,
    record.title || record.symbol || record.stage,
    record.summary || record.detail,
  ]).join(": ");
};

export const buildFailurePointFromAlgoAttentionItem = (item) => {
  const record = asRecord(item);
  const severity = normalizeSeverity(record.severity);
  return buildFailurePoint({
    severity,
    title: record.title || record.symbol || record.stage || "Algo attention",
    summary: record.summary || record.detail || record.description,
    source: record.kind || "algo",
    reason: record.reason || record.code || record.kindLabel,
    observedAt: record.observedAt || record.occurredAt || record.at,
    metrics: metricRows([
      metric("Kind", record.kindLabel || record.kind),
      metric("Symbol", record.symbol),
      metric("Stage", record.stage),
      metric("Action", record.action),
    ]),
    topCauses: compact([
      record.detail || record.summary || record.description,
      record.action,
    ]),
    nextAction:
      record.action ||
      "Inspect the matching Algo attention row, rule, or audit event before running the next scan.",
  });
};

export const buildAlgoStatusFailurePoint = ({
  status,
  gatewayReady,
  marketDataReady = gatewayReady,
  scanOn,
  deploymentEnabled,
  attentionItems = [],
  cockpitTradePath = {},
} = {}) => {
  const severity = normalizeSeverity(status);
  const gatewayBlocks = finiteNumber(asRecord(cockpitTradePath).gatewayBlocks) ?? 0;
  const rankedAttention = (Array.isArray(attentionItems) ? attentionItems : [])
    .filter((item) => normalizeSeverity(asRecord(item).severity) === "warning")
    .slice(0, 4);
  const causes = compact([
    deploymentEnabled === false ? "Deployment is paused." : null,
    marketDataReady === false ? "Market-data stream is not ready." : null,
    scanOn === false ? "Signal-options scan is not running." : null,
    rankedAttention.map(attentionLabel),
    gatewayBlocks > 0 ? `${formatCount(gatewayBlocks)} gateway block${gatewayBlocks === 1 ? "" : "s"} reported.` : null,
  ]);
  const firstCause = causes[0];
  const nextAction =
    marketDataReady === false
      ? "Configure or repair the Massive market-data stream, then re-check Algo readiness."
      : rankedAttention.length
        ? "Open the Algo attention/audit detail for the top warning item."
        : deploymentEnabled === false
          ? "Resume the deployment only after confirming the intended mode and account."
          : "Run a fresh scan or inspect the Diagnostics tab for stale pipeline state.";

  return buildFailurePoint({
    severity,
    title: `Algo status: ${formatFailureLabel(status || severity)}`,
    summary: firstCause || "No active Algo failure cause is currently reported.",
    source: "algo",
    reason: status,
    metrics: metricRows([
      metric("Market data", marketDataReady ? "ready" : "blocked"),
      metric("Scan", scanOn ? "running" : "paused"),
      metric("Deployment", deploymentEnabled === false ? "paused" : "enabled"),
      metric("Attention", formatCount(rankedAttention.length)),
      metric("Gateway blocks", gatewayBlocks > 0 ? formatCount(gatewayBlocks) : null),
    ]),
    topCauses: causes,
    nextAction,
  });
};

export const buildAlgoMetricFailurePoint = ({
  label,
  value,
  detail,
  severity,
  source = "algo",
  nextAction,
} = {}) =>
  buildFailurePoint({
    severity,
    title: label ? `${label} ${formatFailureLabel(severity)}` : "Metric warning",
    summary: compact([value, detail]).join(" / "),
    source,
    reason: label,
    metrics: metricRows([metric("Value", value), metric("Detail", detail)]),
    topCauses: compact([detail]),
    nextAction:
      nextAction ||
      "Inspect the related metric panel and confirm whether this is expected for the current session.",
  });

export const buildPipelineStageFailurePoint = ({ stage, leak } = {}) => {
  const record = asRecord(stage);
  const severity = normalizeSeverity(record.status);
  return buildFailurePoint({
    severity,
    title: `${record.label || "Pipeline stage"} ${formatFailureLabel(record.status || severity)}`,
    summary:
      record.detail ||
      (record.count != null ? `${formatCount(record.count)} item${Number(record.count) === 1 ? "" : "s"}` : null),
    source: "algo pipeline",
    reason: record.status,
    metrics: metricRows([
      metric("Count", formatCount(record.count)),
      metric("Status", formatFailureLabel(record.status)),
      metric("Drop", leak),
    ]),
    topCauses: compact([record.detail, leak ? `Drop to next stage: ${leak}` : null]),
    nextAction: "Select this pipeline stage and inspect the filtered candidate table for the concrete blocker.",
  });
};

export const buildDiagRowFailurePoint = ({ panelTitle, label, count, color } = {}) =>
  buildFailurePoint({
    severity: finiteNumber(count) > 0 ? "warning" : "info",
    title: `${panelTitle || "Diagnostic"}: ${formatFailureLabel(label)}`,
    summary: `${formatCount(count) || "0"} recent occurrence${Number(count) === 1 ? "" : "s"}.`,
    source: "algo diagnostics",
    reason: label,
    metrics: metricRows([
      metric("Panel", panelTitle),
      metric("Count", formatCount(count)),
      metric("Tone", color),
    ]),
    topCauses: compact([formatFailureLabel(label)]),
    nextAction: "Open the Algo diagnostics panel and correlate this reason with recent audit events.",
  });

export const buildIbkrConnectionFailurePoint = ({
  label = "IBKR",
  connection,
  runtime,
  proof,
  tone,
} = {}) => {
  const merged = {
    ...asRecord(connection),
    ...asRecord(runtime),
    ...asRecord(proof),
  };
  const strictReady = merged.strictReady === true;
  const reason =
    merged.strictReason ||
    merged.streamStateReason ||
    merged.healthError ||
    merged.healthErrorCode ||
    tone?.label;
  const causes = compact([
    merged.bridgeReachable === false ? "Bridge unreachable." : null,
    merged.socketConnected === false ? "Socket disconnected." : null,
    merged.brokerServerConnected === false ? "Broker server disconnected." : null,
    merged.authenticated === false ? "Gateway authentication is not ready." : null,
    merged.accountsLoaded === false ? "Accounts are not loaded." : null,
    merged.streamFresh === false ? "Market-data stream is stale." : null,
    reason ? `Reason: ${formatReason(reason)}` : null,
  ]);
  return buildFailurePoint({
    severity: strictReady ? "info" : "warning",
    title: `${label}: ${strictReady ? "Ready" : "Needs attention"}`,
    summary: causes[0] || "Bridge readiness proof is currently healthy.",
    source: "ibkr",
    reason,
    observedAt: merged.lastServerConnectivityAt || merged.updatedAt,
    metrics: metricRows([
      metric("Strict ready", strictReady ? "yes" : "no"),
      metric("Health age", formatDuration(merged.healthAgeMs)),
      metric("Stream age", formatDuration(merged.lastStreamEventAgeMs)),
      metric("Stream state", merged.streamState),
    ]),
    topCauses: causes,
    nextAction: strictReady
      ? "No action required unless stream freshness changes."
      : "Check the bridge helper, gateway login/session, and stream freshness before relying on live data.",
  });
};

export const buildMemoryPressureFailurePoint = ({ signal, driver } = {}) => {
  const record = asRecord(signal);
  const driverRecord = asRecord(driver);
  const level = String(driverRecord.level || record.level || "normal").toLowerCase();
  const severity = level === "normal" ? "info" : "warning";
  const dominantDrivers = Array.isArray(record.dominantDrivers)
    ? record.dominantDrivers
    : Array.isArray(record.pressureDrivers)
      ? record.pressureDrivers
      : [];
  return buildFailurePoint({
    severity,
    title: `${driverRecord.label || "Memory pressure"} ${level.toUpperCase()}`,
    summary: driverCause(driverRecord) || driverCause(dominantDrivers[0]) || `Pressure level is ${level}.`,
    source: "resource-pressure",
    reason: level,
    observedAt: record.observedAt,
    metrics: metricRows([
      metric("Level", level.toUpperCase()),
      metric("Trend", record.trend),
      metric("API RSS", finiteNumber(record.apiRssMb) !== null ? `${Math.round(Number(record.apiRssMb))}M` : null),
      metric("API heap", finiteNumber(record.apiHeapUsedPercent) !== null ? `${Math.round(Number(record.apiHeapUsedPercent))}%` : null),
    ]),
    topCauses: compact([
      driverCause(driverRecord),
      dominantDrivers.map(driverCause),
    ]),
    nextAction: "Inspect footer pressure details and pause background hydration if the driver is latency or cache pressure.",
  });
};
