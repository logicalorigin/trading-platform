type EvidenceValue = boolean | number | string | null;
type EvidenceRecord = Record<string, EvidenceValue>;

const warningSeverities = ["info", "warning", "alert"] as const;
const warningScopes = [
  "external",
  "metric",
  "optimization",
  "risk",
  "sample",
] as const;

export type BacktestValidationWarningSeverity =
  (typeof warningSeverities)[number];
export type BacktestValidationWarningScope = (typeof warningScopes)[number];

export type BacktestValidationWarningDetail = {
  code: string;
  severity: BacktestValidationWarningSeverity;
  scope: BacktestValidationWarningScope;
  message: string;
  evidence: EvidenceRecord;
};

export type BacktestValidationWarningItem = {
  id: string;
  code: string;
  severity: BacktestValidationWarningSeverity;
  severityLabel: string;
  scope: BacktestValidationWarningScope;
  scopeLabel: string;
  message: string;
  evidence: string[];
  source: "run" | "validation";
};

type BuildBacktestValidationWarningItemsInput = {
  runWarnings?: unknown;
  validation?: unknown;
};

const severityLabels: Record<BacktestValidationWarningSeverity, string> = {
  alert: "Alert",
  info: "Info",
  warning: "Warning",
};

const scopeLabels: Record<BacktestValidationWarningScope, string> = {
  external: "Run",
  metric: "Metric",
  optimization: "Optimization",
  risk: "Risk",
  sample: "Sample",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeDedupKey(value: string): string {
  return normalizeText(value).toLowerCase();
}

function normalizeSeverity(
  value: unknown,
): BacktestValidationWarningSeverity | null {
  return warningSeverities.includes(value as BacktestValidationWarningSeverity)
    ? (value as BacktestValidationWarningSeverity)
    : null;
}

function normalizeScope(value: unknown): BacktestValidationWarningScope | null {
  return warningScopes.includes(value as BacktestValidationWarningScope)
    ? (value as BacktestValidationWarningScope)
    : null;
}

function isEvidenceValue(value: unknown): value is EvidenceValue {
  if (value === null) {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  return typeof value === "boolean" || typeof value === "string";
}

function normalizeEvidence(value: unknown): EvidenceRecord {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, EvidenceValue] =>
      isEvidenceValue(entry[1]),
    ),
  );
}

function normalizeWarningDetail(
  value: unknown,
): BacktestValidationWarningDetail | null {
  if (!isRecord(value)) {
    return null;
  }

  const code = typeof value.code === "string" ? normalizeText(value.code) : "";
  const message =
    typeof value.message === "string" ? normalizeText(value.message) : "";
  const severity = normalizeSeverity(value.severity);
  const scope = normalizeScope(value.scope);

  if (!code || !message || severity === null || scope === null) {
    return null;
  }

  return {
    code,
    severity,
    scope,
    message,
    evidence: normalizeEvidence(value.evidence),
  };
}

export function normalizeBacktestValidationWarningDetails(
  value: unknown,
): BacktestValidationWarningDetail[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const detail = normalizeWarningDetail(item);
        return detail === null ? [] : [detail];
      })
    : [];
}

function getEvidenceNumber(
  evidence: EvidenceRecord,
  key: string,
): number | null {
  const value = evidence[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatEvidenceNumber(value: number): string {
  if (Number.isInteger(value)) {
    return value.toString();
  }

  const absolute = Math.abs(value);
  if (absolute >= 100) {
    return value.toFixed(0);
  }
  if (absolute >= 10) {
    return value.toFixed(1);
  }

  return value.toFixed(2);
}

function compactEvidence(values: Array<string | null>): string[] {
  return values.filter((value): value is string => value !== null);
}

function formatRatioEvidence(
  label: string,
  numerator: number | null,
  denominatorLabel: string,
  denominator: number | null,
): string | null {
  if (numerator === null || denominator === null) {
    return null;
  }

  return `${label} ${formatEvidenceNumber(numerator)} / ${denominatorLabel} ${formatEvidenceNumber(denominator)}`;
}

function formatNumberEvidence(
  evidence: EvidenceRecord,
  key: string,
  label: string,
  suffix = "",
): string | null {
  const value = getEvidenceNumber(evidence, key);
  if (value === null) {
    return null;
  }

  return `${label} ${formatEvidenceNumber(value)}${suffix}`;
}

function formatEvidenceValue(value: EvidenceValue): string {
  if (typeof value === "number") {
    return formatEvidenceNumber(value);
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  return value ?? "none";
}

function labelEvidenceKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function buildEvidenceSummary(
  detail: BacktestValidationWarningDetail,
): string[] {
  const { code, evidence } = detail;

  if (code === "low_trade_count") {
    return compactEvidence([
      formatRatioEvidence(
        "Trades",
        getEvidenceNumber(evidence, "tradeCount"),
        "min",
        getEvidenceNumber(evidence, "minimumTradeCount"),
      ),
    ]);
  }

  if (code === "too_many_trials") {
    return compactEvidence([
      formatNumberEvidence(evidence, "trialCount", "Trials"),
      formatNumberEvidence(evidence, "trialThreshold", "threshold"),
      formatNumberEvidence(evidence, "parameterCount", "Parameters"),
    ]);
  }

  if (code === "missing_out_of_sample_window") {
    return compactEvidence([
      formatNumberEvidence(evidence, "trialCount", "Trials"),
      formatNumberEvidence(evidence, "oosWindowCount", "OOS windows"),
    ]);
  }

  if (code === "excessive_drawdown_duration") {
    return compactEvidence([
      formatNumberEvidence(
        evidence,
        "maxDrawdownDurationBars",
        "Drawdown",
        " bars",
      ),
      formatNumberEvidence(
        evidence,
        "drawdownDurationThreshold",
        "threshold",
        " bars",
      ),
    ]);
  }

  if (code === "unstable_sharpe") {
    return compactEvidence([
      formatNumberEvidence(evidence, "sharpeRatio", "Sharpe"),
      formatNumberEvidence(evidence, "deflatedSharpeRatio", "Deflated"),
      formatNumberEvidence(evidence, "sharpePenalty", "Penalty"),
    ]);
  }

  if (code === "insufficient_sample_size") {
    return compactEvidence([
      formatRatioEvidence(
        "Return sample",
        getEvidenceNumber(evidence, "returnSampleSize"),
        "min",
        getEvidenceNumber(evidence, "minimumReturnSampleSize"),
      ),
    ]);
  }

  return Object.entries(evidence)
    .slice(0, 3)
    .map(([key, value]) => `${labelEvidenceKey(key)} ${formatEvidenceValue(value)}`);
}

function buildStructuredWarningItem(
  detail: BacktestValidationWarningDetail,
  index: number,
): BacktestValidationWarningItem {
  return {
    id: `validation:${detail.code}:${index}`,
    code: detail.code,
    severity: detail.severity,
    severityLabel: severityLabels[detail.severity],
    scope: detail.scope,
    scopeLabel: scopeLabels[detail.scope],
    message: detail.message,
    evidence: buildEvidenceSummary(detail),
    source: "validation",
  };
}

function buildLegacyWarningItem(
  message: string,
  source: "run" | "validation",
  index: number,
): BacktestValidationWarningItem {
  const severity = source === "validation" ? "warning" : "info";
  const scope: BacktestValidationWarningScope = "external";

  return {
    id: `${source}:${index}`,
    code: source === "validation" ? "validation_warning" : "run_warning",
    severity,
    severityLabel: severityLabels[severity],
    scope,
    scopeLabel: scopeLabels[scope],
    message,
    evidence: [],
    source,
  };
}

export function buildBacktestValidationWarningItems({
  runWarnings,
  validation,
}: BuildBacktestValidationWarningItemsInput): BacktestValidationWarningItem[] {
  const validationRecord = isRecord(validation) ? validation : null;
  const warningDetails = normalizeBacktestValidationWarningDetails(
    validationRecord?.warningDetails,
  );
  const legacyRunWarnings = asStringArray(runWarnings).map(normalizeText);
  const legacyValidationWarnings = asStringArray(
    validationRecord?.warnings,
  ).map(normalizeText);

  const items: BacktestValidationWarningItem[] = [];
  const seenMessages = new Set<string>();
  const seenStructuredWarnings = new Set<string>();

  warningDetails.forEach((detail, index) => {
    const messageKey = normalizeDedupKey(detail.message);
    const structuredKey = `${detail.code}:${messageKey}`;
    if (seenStructuredWarnings.has(structuredKey)) {
      return;
    }

    seenStructuredWarnings.add(structuredKey);
    seenMessages.add(messageKey);
    items.push(buildStructuredWarningItem(detail, index));
  });

  [
    ...legacyRunWarnings.map((message, index) => ({
      message,
      source: "run" as const,
      index,
    })),
    ...legacyValidationWarnings.map((message, index) => ({
      message,
      source: "validation" as const,
      index,
    })),
  ].forEach(({ message, source, index }) => {
    if (!message) {
      return;
    }

    const messageKey = normalizeDedupKey(message);
    if (seenMessages.has(messageKey)) {
      return;
    }

    seenMessages.add(messageKey);
    items.push(buildLegacyWarningItem(message, source, index));
  });

  return items;
}
