import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";
import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { closeDatabaseConnections, pool } from "@workspace/db";
import { isSignalOptionsShadowConfig } from "../../artifacts/api-server/src/services/algo-deployment-account";
import { listSignalOptionsActivePositionsForDeployment } from "../../artifacts/api-server/src/services/signal-options-automation";

type JsonRecord = Record<string, unknown>;

type DiagnosticsStatus =
  | "disabled"
  | "idle"
  | "pending_marks"
  | "partial"
  | "ready";

type DeploymentSummary = {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string | null;
};

type ProfileSummary = {
  greekPositionManagementEnabled: boolean;
  wireGreekTrailEnabled: boolean;
};

export type GreekManagementSnapshot = {
  available?: boolean | null;
  enforcing?: boolean | null;
  recommendation?: string | null;
  reasons?: unknown[] | null;
  fresh?: boolean | null;
  ageMs?: number | null;
  fallbackReason?: string | null;
  currentDelta?: number | null;
  entryDelta?: number | null;
  deltaImprovement?: number | null;
  currentGamma?: number | null;
  currentTheta?: number | null;
  thetaBurdenPct?: number | null;
};

export type GreekPositionDiagnosticsInput = {
  generatedAt: string;
  deployment: DeploymentSummary;
  profile: ProfileSummary;
  activePositions: Array<{
    symbol: string;
    lastMarkedAt: string | null;
    lastMarkPrice?: number | null;
    stopPrice?: number | null;
    greekManagement?: GreekManagementSnapshot | null;
  }>;
  recentEvents: {
    total: number;
    marks: number;
    marksWithGreekManagement: number;
    latestMarkAt: string | null;
    latestEventAt: string | null;
  };
};

export type GreekPositionDiagnostics = {
  generatedAt: string;
  status: DiagnosticsStatus;
  deployment: DeploymentSummary;
  profile: ProfileSummary;
  summary: {
    activePositions: number;
    positionsWithGreekManagement: number;
    freshGreekPositions: number;
    staleOrFallbackGreekPositions: number;
    recommendations: Record<string, number>;
    recentEvents: GreekPositionDiagnosticsInput["recentEvents"];
  };
  positions: Array<{
    symbol: string;
    lastMarkedAt: string | null;
    lastMarkPrice: number | null;
    stopPrice: number | null;
    recommendation: string;
    available: boolean | null;
    fresh: boolean | null;
    enforcing: boolean | null;
    reasons: string[];
    ageMs: number | null;
    deltaImprovement: number | null;
    thetaBurdenPct: number | null;
    currentDelta: number | null;
    entryDelta: number | null;
    currentGamma: number | null;
    currentTheta: number | null;
  }>;
};

type Config = {
  deploymentId: string | null;
  eventLimit: number;
  reportDir: string;
  requireReady: boolean;
  help: boolean;
};

type EventRow = {
  event_type: string;
  payload: unknown;
  occurred_at: Date | string;
};

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow" | "live";
  enabled: boolean;
  providerAccountId: string;
  updatedAt: Date | string | null;
  config: unknown;
};

type DiagnosticsDependencies = {
  readDeployment: (deploymentId: string | null) => Promise<DeploymentRow>;
  listActivePositions: (input: { deploymentId: string }) => Promise<{
    positions: unknown[];
  }>;
  readRecentEvents: (
    deploymentId: string,
    limit: number,
  ) => Promise<EventRow[]>;
  now: () => Date;
};

const SIGNAL_OPTIONS_MARK_EVENT = "signal_options_shadow_mark";
const SIGNAL_OPTIONS_REPLAY_SOURCE = "signal_options_replay";
const DEFAULT_EVENT_LIMIT = 750;
const MAX_EVENT_LIMIT = 10_000;
const MAX_DIAGNOSTIC_LENGTH = 400;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GREEK_RECOMMENDATIONS = new Set([
  "unavailable",
  "tighten",
  "loosen",
  "hold",
]);
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const UNSAFE_JSON_OUTPUT_PATTERN =
  /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const USAGE = `Usage: pnpm --filter @workspace/scripts run signal-options:greek-position-diagnostics -- [options]

Read-only diagnostic for Greek-management coverage on active shadow signal-options positions.

Options:
  --deployment-id=<uuid>  Inspect one shadow signal-options deployment.
  --event-limit=<1-10000> Recent runtime events to summarize (default: 750).
  --report-dir=<path>     New destination directory for results.json and report.md.
  --require-ready         Exit 2 unless every active position has diagnostics.
  -h, --help              Show this help without querying the database.`;

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultReportDir(cwd: string): string {
  return path.resolve(
    cwd,
    "reports",
    "signal-options-greek-position-diagnostics",
    slug(),
  );
}

function configError(message: string): Error {
  return new Error(`${message}\n\n${USAGE}`);
}

function parseArguments(args: string[]) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseNodeArgs({
      args: normalizedArgs,
      options: {
        "deployment-id": { type: "string" },
        "event-limit": { type: "string" },
        "report-dir": { type: "string" },
        "require-ready": { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    for (const name of [
      "deployment-id",
      "event-limit",
      "report-dir",
      "require-ready",
      "help",
    ] as const) {
      if (
        parsed.tokens.filter(
          (token) => token.kind === "option" && token.name === name,
        ).length > 1
      ) {
        throw new Error(`Duplicate argument: --${name}`);
      }
    }
    return parsed.values;
  } catch (error) {
    throw configError(
      error instanceof Error ? error.message : "Invalid command arguments.",
    );
  }
}

function readEnvironmentValue(
  env: NodeJS.ProcessEnv,
  name: string,
): string | undefined {
  if (env[name] === undefined) {
    return undefined;
  }
  const value = env[name]?.trim();
  if (!value) {
    throw configError(`${name} cannot be blank.`);
  }
  return value;
}

function deploymentId(value: string, name: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    throw configError(`${name} must be a UUID.`);
  }
  return normalized;
}

function eventLimit(value: string, name: string): number {
  if (!/^[1-9]\d*$/u.test(value)) {
    throw configError(`${name} must be an integer from 1 through 10000.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_EVENT_LIMIT) {
    throw configError(`${name} must be an integer from 1 through 10000.`);
  }
  return parsed;
}

function booleanValue(value: string, name: string): boolean {
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw configError(
        `${name} must be true or false (also accepts 1/0, yes/no, on/off).`,
      );
  }
}

function resolveStringSetting<T extends string | number>(input: {
  cliName: string;
  cliValue: string | undefined;
  envName: string;
  env: NodeJS.ProcessEnv;
  parse: (value: string, name: string) => T;
}): T | null {
  const cliValue =
    input.cliValue === undefined
      ? null
      : input.parse(input.cliValue, `--${input.cliName}`);
  const rawEnvValue = readEnvironmentValue(input.env, input.envName);
  const envValue = rawEnvValue ? input.parse(rawEnvValue, input.envName) : null;
  if (cliValue != null && envValue != null && cliValue !== envValue) {
    throw configError(`--${input.cliName} conflicts with ${input.envName}.`);
  }
  return cliValue ?? envValue;
}

function readConfig(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Config {
  const cli = parseArguments(args);
  if (cli.help === true) {
    return {
      deploymentId: null,
      eventLimit: DEFAULT_EVENT_LIMIT,
      reportDir: defaultReportDir(cwd),
      requireReady: false,
      help: true,
    };
  }

  const requestedDeploymentId = resolveStringSetting({
    cliName: "deployment-id",
    cliValue: cli["deployment-id"],
    envName: "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_DEPLOYMENT_ID",
    env,
    parse: deploymentId,
  });
  const requestedEventLimit = resolveStringSetting({
    cliName: "event-limit",
    cliValue: cli["event-limit"],
    envName: "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT",
    env,
    parse: eventLimit,
  });
  const requestedReportDir = resolveStringSetting({
    cliName: "report-dir",
    cliValue: cli["report-dir"],
    envName: "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REPORT_DIR",
    env,
    parse: (value, name) => {
      const trimmed = value.trim();
      if (!trimmed) {
        throw configError(`${name} requires a non-blank path.`);
      }
      return path.resolve(cwd, trimmed);
    },
  });

  const cliRequireReady = cli["require-ready"];
  const envRequireValue = readEnvironmentValue(
    env,
    "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY",
  );
  const envRequireReady = envRequireValue
    ? booleanValue(
        envRequireValue,
        "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY",
      )
    : null;
  if (
    cliRequireReady !== undefined &&
    envRequireReady != null &&
    cliRequireReady !== envRequireReady
  ) {
    throw configError(
      "--require-ready conflicts with SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY.",
    );
  }

  return {
    deploymentId: requestedDeploymentId,
    eventLimit: requestedEventLimit ?? DEFAULT_EVENT_LIMIT,
    reportDir: requestedReportDir ?? defaultReportDir(cwd),
    requireReady: cliRequireReady ?? envRequireReady ?? false,
    help: false,
  };
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = (raw || "Unknown Greek-position diagnostics error")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/giu, "$1?[redacted]")
    .replace(
      /\b(password|passwd|pwd|token|secret)=([^\s&]+)/giu,
      "$1=[redacted]",
    );
  const cleaned = stripVTControlCharacters(redacted)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown Greek-position diagnostics error";
  return diagnostic.length <= MAX_DIAGNOSTIC_LENGTH
    ? diagnostic
    : `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function compactString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIsoString(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

function normalizeSymbol(value: unknown): string {
  return compactString(value)?.toUpperCase() ?? "";
}

function greekManagementFrom(value: unknown): GreekManagementSnapshot | null {
  const record = asRecord(value);
  const recommendation = compactString(record.recommendation)?.toLowerCase();
  if (!recommendation || !GREEK_RECOMMENDATIONS.has(recommendation)) {
    return null;
  }
  return {
    recommendation,
    available: booleanOrNull(record.available),
    enforcing: booleanOrNull(record.enforcing),
    reasons: asArray(record.reasons)
      .map(compactString)
      .filter((reason): reason is string => reason != null),
    fresh: booleanOrNull(record.fresh),
    ageMs: finiteNumber(record.ageMs),
    fallbackReason: compactString(record.fallbackReason),
    currentDelta: finiteNumber(record.currentDelta),
    entryDelta: finiteNumber(record.entryDelta),
    deltaImprovement: finiteNumber(record.deltaImprovement),
    currentGamma: finiteNumber(record.currentGamma),
    currentTheta: finiteNumber(record.currentTheta),
    thetaBurdenPct: finiteNumber(record.thetaBurdenPct),
  };
}

function isReplayLikePayload(payload: unknown): boolean {
  const record = asRecord(payload);
  const metadata = asRecord(record.metadata);
  const replay = asRecord(record.replay);
  const backfill = asRecord(record.backfill);
  return (
    compactString(metadata.sourceType) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(metadata.runSource) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(metadata.runMode) === "replay" ||
    compactString(replay.source) === SIGNAL_OPTIONS_REPLAY_SOURCE ||
    compactString(backfill.source) === SIGNAL_OPTIONS_REPLAY_SOURCE
  );
}

function recentEventSummary(
  events: EventRow[],
): GreekPositionDiagnosticsInput["recentEvents"] {
  const runtimeEvents = events.filter(
    (event) => !isReplayLikePayload(event.payload),
  );
  const marks = runtimeEvents.filter(
    (event) => event.event_type === SIGNAL_OPTIONS_MARK_EVENT,
  );
  return {
    total: runtimeEvents.length,
    marks: marks.length,
    marksWithGreekManagement: marks.filter((event) => {
      const payload = asRecord(event.payload);
      const position = asRecord(payload.position);
      const lastStop = asRecord(position.lastStop ?? payload.stop);
      return greekManagementFrom(lastStop.greekManagement) != null;
    }).length,
    latestMarkAt: marks[0] ? toIsoString(marks[0].occurred_at) : null,
    latestEventAt: runtimeEvents[0]
      ? toIsoString(runtimeEvents[0].occurred_at)
      : null,
  };
}

export function buildGreekPositionDiagnostics(
  input: GreekPositionDiagnosticsInput,
): GreekPositionDiagnostics {
  const enabled =
    input.profile.greekPositionManagementEnabled ||
    input.profile.wireGreekTrailEnabled;
  const positions = input.activePositions.map((position) => {
    const greek = greekManagementFrom(position.greekManagement);
    const recommendation = compactString(greek?.recommendation) ?? "missing";
    return {
      symbol: normalizeSymbol(position.symbol),
      lastMarkedAt: toIsoString(position.lastMarkedAt),
      lastMarkPrice: finiteNumber(position.lastMarkPrice),
      stopPrice: finiteNumber(position.stopPrice),
      recommendation,
      available: booleanOrNull(greek?.available),
      fresh: booleanOrNull(greek?.fresh),
      enforcing: booleanOrNull(greek?.enforcing),
      reasons: asArray(greek?.reasons).filter(
        (reason): reason is string => typeof reason === "string",
      ),
      ageMs: finiteNumber(greek?.ageMs),
      deltaImprovement: finiteNumber(greek?.deltaImprovement),
      thetaBurdenPct: finiteNumber(greek?.thetaBurdenPct),
      currentDelta: finiteNumber(greek?.currentDelta),
      entryDelta: finiteNumber(greek?.entryDelta),
      currentGamma: finiteNumber(greek?.currentGamma),
      currentTheta: finiteNumber(greek?.currentTheta),
    };
  });
  const positionsWithGreekManagement = positions.filter(
    (position) => position.recommendation !== "missing",
  ).length;
  const freshGreekPositions = positions.filter(
    (position) =>
      position.recommendation !== "missing" && position.fresh === true,
  ).length;
  const recommendations: Record<string, number> = {};
  for (const position of positions) {
    if (position.recommendation === "missing") {
      continue;
    }
    recommendations[position.recommendation] =
      (recommendations[position.recommendation] ?? 0) + 1;
  }
  const status: DiagnosticsStatus = !enabled
    ? "disabled"
    : positions.length === 0
      ? "idle"
      : positionsWithGreekManagement === 0
        ? "pending_marks"
        : positionsWithGreekManagement < positions.length
          ? "partial"
          : "ready";
  return {
    generatedAt: input.generatedAt,
    status,
    deployment: input.deployment,
    profile: input.profile,
    summary: {
      activePositions: positions.length,
      positionsWithGreekManagement,
      freshGreekPositions,
      staleOrFallbackGreekPositions:
        positionsWithGreekManagement - freshGreekPositions,
      recommendations,
      recentEvents: input.recentEvents,
    },
    positions,
  };
}

export function greekPositionDiagnosticsReadyGate(
  diagnostics: GreekPositionDiagnostics,
): { passed: boolean; reason: string } {
  if (diagnostics.status === "ready") {
    return { passed: true, reason: "ready" };
  }
  if (diagnostics.status === "disabled") {
    return { passed: false, reason: "greek_position_diagnostics_disabled" };
  }
  if (diagnostics.status === "idle") {
    return { passed: false, reason: "no_active_positions_to_verify" };
  }
  if (diagnostics.status === "pending_marks") {
    return {
      passed: false,
      reason: "active_positions_missing_greek_management",
    };
  }
  return {
    passed: false,
    reason: "some_active_positions_missing_greek_management",
  };
}

function cell(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_[\]{}()#+.!|~>-])/gu, "\\$1");
}

function numberCell(value: number | null, digits = 2): string {
  return value == null ? "" : value.toFixed(digits);
}

function jsonText(value: unknown, space?: number): string {
  return (
    JSON.stringify(
      value,
      (_key, item) =>
        typeof item === "number" && !Number.isFinite(item)
          ? String(item)
          : item,
      space,
    ) ?? "null"
  ).replace(
    UNSAFE_JSON_OUTPUT_PATTERN,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );
}

export function renderGreekPositionDiagnosticsMarkdown(
  diagnostics: GreekPositionDiagnostics,
): string {
  const summary = diagnostics.summary;
  const readyGate = greekPositionDiagnosticsReadyGate(diagnostics);
  return [
    "# Signal Options Greek Position Diagnostics",
    "",
    `- Generated: ${cell(diagnostics.generatedAt)}`,
    `- Deployment: ${cell(diagnostics.deployment.name)} (${cell(diagnostics.deployment.id)})`,
    `- Deployment enabled: ${cell(diagnostics.deployment.enabled)}`,
    `- Deployment updated at: ${cell(diagnostics.deployment.updatedAt ?? "-")}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Status | ${cell(diagnostics.status)} |`,
    `| Ready gate passed | ${cell(readyGate.passed)} |`,
    `| Ready gate reason | ${cell(readyGate.reason)} |`,
    `| Greek diagnostics enabled | ${cell(diagnostics.profile.greekPositionManagementEnabled)} |`,
    `| Wire Greek trail enabled | ${cell(diagnostics.profile.wireGreekTrailEnabled)} |`,
    `| Active positions | ${summary.activePositions} |`,
    `| Positions with Greek management | ${summary.positionsWithGreekManagement} |`,
    `| Fresh Greek positions | ${summary.freshGreekPositions} |`,
    `| Stale/fallback Greek positions | ${summary.staleOrFallbackGreekPositions} |`,
    `| Recent events scanned | ${summary.recentEvents.total} |`,
    `| Recent mark events | ${summary.recentEvents.marks} |`,
    `| Recent marks with Greek management | ${summary.recentEvents.marksWithGreekManagement} |`,
    `| Latest mark at | ${cell(summary.recentEvents.latestMarkAt ?? "-")} |`,
    `| Latest event at | ${cell(summary.recentEvents.latestEventAt ?? "-")} |`,
    "",
    "## Recommendations",
    "",
    Object.keys(summary.recommendations).length
      ? [
          "| Recommendation | Positions |",
          "| --- | ---: |",
          ...Object.entries(summary.recommendations)
            .sort(
              (left, right) =>
                right[1] - left[1] || left[0].localeCompare(right[0]),
            )
            .map(
              ([recommendation, count]) =>
                `| ${cell(recommendation)} | ${count} |`,
            ),
        ].join("\n")
      : "No Greek recommendations observed yet.",
    "",
    "## Active Positions",
    "",
    diagnostics.positions.length
      ? [
          "| Symbol | Recommendation | Fresh | Enforcing | Last Marked | Mark | Stop | Delta Improvement | Theta Burden % | Reasons |",
          "| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
          ...diagnostics.positions.map(
            (position) =>
              `| ${[
                cell(position.symbol),
                cell(position.recommendation),
                cell(position.fresh),
                cell(position.enforcing),
                cell(position.lastMarkedAt),
                numberCell(position.lastMarkPrice),
                numberCell(position.stopPrice),
                numberCell(position.deltaImprovement, 4),
                numberCell(position.thetaBurdenPct, 2),
                cell(position.reasons.join(", ")),
              ].join(" | ")} |`,
          ),
        ].join("\n")
      : "No active positions.",
    "",
  ].join("\n");
}

function validateDeployment(value: unknown): DeploymentRow {
  const row = asRecord(value);
  const id = compactString(row.id)?.toLowerCase() ?? "";
  const name = compactString(row.name) ?? "";
  if (!UUID_PATTERN.test(id) || !name || typeof row.enabled !== "boolean") {
    throw new Error(
      "Invalid deployment row: expected a valid deployment ID, name, and enabled flag.",
    );
  }
  if (
    row.mode !== "shadow" ||
    row.providerAccountId !== "shadow" ||
    !isSignalOptionsShadowConfig(row.config)
  ) {
    throw new Error(
      `Deployment ${id} is not a shadow signal-options deployment.`,
    );
  }
  return {
    id,
    name,
    mode: "shadow",
    enabled: row.enabled,
    providerAccountId: "shadow",
    updatedAt:
      row.updatedAt instanceof Date ||
      typeof row.updatedAt === "string" ||
      row.updatedAt === null
        ? row.updatedAt
        : null,
    config: row.config,
  };
}

async function readDeployment(
  requestedDeploymentId: string | null,
): Promise<DeploymentRow> {
  const sql = requestedDeploymentId
    ? `
        select
          id,
          name,
          mode,
          enabled,
          provider_account_id as "providerAccountId",
          updated_at as "updatedAt",
          config
        from algo_deployments
        where id = $1
        limit 1
      `
    : `
        select
          id,
          name,
          mode,
          enabled,
          provider_account_id as "providerAccountId",
          updated_at as "updatedAt",
          config
        from algo_deployments
        where enabled = true
          and mode = 'shadow'
          and provider_account_id = 'shadow'
          and (
            config->'parameters'->>'executionMode' = 'signal_options'
            or (
              jsonb_typeof(config->'signalOptions') = 'object'
              and config->'signalOptions' <> '{}'::jsonb
            )
          )
        order by
          case when name = 'Pyrus Signals Options Shadow' then 0 else 1 end,
          updated_at desc
        limit 1
      `;
  const result = await pool.query(
    sql,
    requestedDeploymentId ? [requestedDeploymentId] : [],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      requestedDeploymentId
        ? `No deployment found for ${requestedDeploymentId}.`
        : "No enabled shadow signal-options deployment found.",
    );
  }
  return validateDeployment(row);
}

async function readRecentEvents(
  deploymentId: string,
  limit: number,
): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `
      select event_type, payload, occurred_at
      from execution_events
      where deployment_id = $1
        and event_type like 'signal_options_%'
      order by occurred_at desc
      limit $2
    `,
    [deploymentId, limit],
  );
  return result.rows;
}

const defaultDiagnosticsDependencies: DiagnosticsDependencies = {
  readDeployment,
  listActivePositions: listSignalOptionsActivePositionsForDeployment,
  readRecentEvents,
  now: () => new Date(),
};

async function buildDiagnosticsFromDb(
  config: Config,
  dependencies: DiagnosticsDependencies = defaultDiagnosticsDependencies,
): Promise<GreekPositionDiagnostics> {
  const deployment = validateDeployment(
    await dependencies.readDeployment(config.deploymentId),
  );
  const profile = resolveSignalOptionsExecutionProfile(deployment.config);
  const activeRead = await dependencies.listActivePositions({
    deploymentId: deployment.id,
  });
  const events = await dependencies.readRecentEvents(
    deployment.id,
    config.eventLimit,
  );
  const activePositions = asArray(activeRead.positions).map((value) => {
    const position = asRecord(value);
    const lastStop = asRecord(position.lastStop);
    return {
      symbol: normalizeSymbol(position.symbol),
      lastMarkedAt: toIsoString(position.lastMarkedAt),
      lastMarkPrice: finiteNumber(position.lastMarkPrice),
      stopPrice: finiteNumber(position.stopPrice),
      greekManagement: greekManagementFrom(lastStop.greekManagement),
    };
  });
  return buildGreekPositionDiagnostics({
    generatedAt: dependencies.now().toISOString(),
    deployment: {
      id: deployment.id,
      name: deployment.name,
      enabled: deployment.enabled,
      updatedAt: toIsoString(deployment.updatedAt),
    },
    profile: {
      greekPositionManagementEnabled:
        profile.exitPolicy.greekPositionManagement.enabled,
      wireGreekTrailEnabled: profile.exitPolicy.wireGreekTrail.enabled,
    },
    activePositions,
    recentEvents: recentEventSummary(events),
  });
}

async function assertReportDestinationAvailable(
  reportDir: string,
): Promise<void> {
  try {
    await lstat(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Report destination already exists: ${reportDir}`);
}

async function publishReportFiles(
  reportDir: string,
  files: Record<"results.json" | "report.md", string>,
): Promise<void> {
  await assertReportDestinationAvailable(reportDir);
  const parent = path.dirname(reportDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(parent, `.${path.basename(reportDir)}.tmp-`),
  );
  try {
    await Promise.all(
      Object.entries(files).map(([name, contents]) =>
        writeFile(path.join(temporaryDir, name), contents),
      ),
    );
    await rename(temporaryDir, reportDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function writeDiagnostics(
  diagnostics: GreekPositionDiagnostics,
  reportDir: string,
): Promise<void> {
  await publishReportFiles(reportDir, {
    "results.json": `${jsonText(diagnostics, 2)}\n`,
    "report.md": `${renderGreekPositionDiagnosticsMarkdown(diagnostics)}\n`,
  });
}

async function main(): Promise<number> {
  const config = readConfig();
  if (config.help) {
    console.log(USAGE);
    return 0;
  }
  await assertReportDestinationAvailable(config.reportDir);
  const diagnostics = await buildDiagnosticsFromDb(config);
  const readyGate = greekPositionDiagnosticsReadyGate(diagnostics);
  await writeDiagnostics(diagnostics, config.reportDir);
  console.log(
    jsonText(
      {
        reportDir: config.reportDir,
        status: diagnostics.status,
        activePositions: diagnostics.summary.activePositions,
        positionsWithGreekManagement:
          diagnostics.summary.positionsWithGreekManagement,
        freshGreekPositions: diagnostics.summary.freshGreekPositions,
        recommendations: diagnostics.summary.recommendations,
        readyGate,
      },
      2,
    ),
  );
  return config.requireReady && !readyGate.passed ? 2 : 0;
}

async function runCli(): Promise<void> {
  let exitCode = 0;
  try {
    exitCode = await main();
  } catch (error) {
    console.error(safeDiagnostic(error));
    exitCode = 1;
  }
  try {
    await closeDatabaseConnections();
  } catch (error) {
    console.error(`Database cleanup failed: ${safeDiagnostic(error)}`);
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

export const __signalOptionsGreekPositionDiagnosticsInternalsForTests = {
  assertReportDestinationAvailable,
  buildDiagnosticsFromDb,
  jsonText,
  recentEventSummary,
  readConfig,
  safeDiagnostic,
  validateDeployment,
  writeDiagnostics,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}
