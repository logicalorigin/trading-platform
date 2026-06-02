import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveSignalOptionsExecutionProfile } from "@workspace/backtest-core";
import { pool } from "@workspace/db";
import { listSignalOptionsAutomationState } from "../../artifacts/api-server/src/services/signal-options-automation";

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
};

type EventRow = {
  event_type: string;
  symbol: string | null;
  summary: string;
  payload: unknown;
  occurred_at: Date | string;
};

const SIGNAL_OPTIONS_ENTRY_EVENT = "signal_options_shadow_entry";
const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";
const SIGNAL_OPTIONS_MARK_EVENT = "signal_options_shadow_mark";

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readPositiveInteger(value: string | undefined | null, fallback: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function readBooleanFlag(name: string, envName: string): boolean {
  if (process.argv.includes(`--${name}`)) {
    return true;
  }
  const value = process.env[envName]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function readConfig(): Config {
  const reportRoot =
    argValue("report-dir") ??
    process.env["SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REPORT_DIR"] ??
    path.join("reports", "signal-options-greek-position-diagnostics", slug());
  return {
    deploymentId:
      argValue("deployment-id") ??
      process.env["SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_DEPLOYMENT_ID"] ??
      null,
    eventLimit: readPositiveInteger(
      argValue("event-limit") ??
        process.env["SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_EVENT_LIMIT"],
      750,
      10_000,
    ),
    reportDir: path.resolve(process.cwd(), reportRoot),
    requireReady: readBooleanFlag(
      "require-ready",
      "SIGNAL_OPTIONS_GREEK_POSITION_DIAGNOSTICS_REQUIRE_READY",
    ),
  };
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  return String(value ?? "").trim().toUpperCase();
}

function greekManagementFrom(value: unknown): GreekManagementSnapshot | null {
  const record = asRecord(value);
  return Object.keys(record).length ? (record as GreekManagementSnapshot) : null;
}

function positionFromPayload(event: EventRow) {
  const payload = asRecord(event.payload);
  const position = asRecord(payload.position);
  const candidate = asRecord(payload.candidate);
  const symbol = normalizeSymbol(position.symbol ?? candidate.symbol ?? event.symbol);
  if (!symbol) {
    return null;
  }
  const lastStop = asRecord(position.lastStop ?? payload.stop);
  return {
    symbol,
    id: compactString(position.id),
    candidateId: compactString(position.candidateId ?? candidate.id),
    lastMarkedAt: toIsoString(position.lastMarkedAt) ?? toIsoString(event.occurred_at),
    lastMarkPrice: finiteNumber(position.lastMarkPrice),
    stopPrice: finiteNumber(position.stopPrice),
    greekManagement: greekManagementFrom(lastStop.greekManagement),
  };
}

function isReplayLikePayload(payload: unknown): boolean {
  const record = asRecord(payload);
  const metadata = asRecord(record.metadata);
  const replay = asRecord(record.replay);
  const backfill = asRecord(record.backfill);
  return [
    metadata.sourceType,
    metadata.runSource,
    metadata.runMode,
    replay.source,
    backfill.source,
  ].some((value) => compactString(value) === "signal_options_replay");
}

function deriveActivePositions(events: EventRow[]): GreekPositionDiagnosticsInput["activePositions"] {
  const positions = new Map<string, NonNullable<ReturnType<typeof positionFromPayload>>>();
  for (const event of [...events].sort((left, right) => {
    const leftTime = new Date(left.occurred_at).getTime();
    const rightTime = new Date(right.occurred_at).getTime();
    return leftTime - rightTime;
  })) {
    if (isReplayLikePayload(event.payload)) {
      continue;
    }
    const symbol = normalizeSymbol(event.symbol);
    if (!symbol) {
      continue;
    }
    if (event.event_type === SIGNAL_OPTIONS_EXIT_EVENT) {
      positions.delete(symbol);
      continue;
    }
    if (
      event.event_type !== SIGNAL_OPTIONS_ENTRY_EVENT &&
      event.event_type !== SIGNAL_OPTIONS_MARK_EVENT
    ) {
      continue;
    }
    const next = positionFromPayload(event);
    if (!next) {
      continue;
    }
    const current = positions.get(next.symbol);
    positions.set(next.symbol, {
      ...current,
      ...next,
      greekManagement: next.greekManagement ?? current?.greekManagement ?? null,
      lastMarkedAt: next.lastMarkedAt ?? current?.lastMarkedAt ?? null,
      lastMarkPrice: next.lastMarkPrice ?? current?.lastMarkPrice ?? null,
      stopPrice: next.stopPrice ?? current?.stopPrice ?? null,
    });
  }
  return Array.from(positions.values()).sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
}

function recentEventSummary(events: EventRow[]): GreekPositionDiagnosticsInput["recentEvents"] {
  const runtimeEvents = events.filter((event) => !isReplayLikePayload(event.payload));
  const marks = runtimeEvents.filter((event) => event.event_type === SIGNAL_OPTIONS_MARK_EVENT);
  return {
    total: runtimeEvents.length,
    marks: marks.length,
    marksWithGreekManagement: marks.filter((event) => {
      const payload = asRecord(event.payload);
      const position = asRecord(payload.position);
      const lastStop = asRecord(position.lastStop ?? payload.stop);
      return Object.keys(asRecord(lastStop.greekManagement)).length > 0;
    }).length,
    latestMarkAt: marks[0] ? toIsoString(marks[0].occurred_at) : null,
    latestEventAt: runtimeEvents[0] ? toIsoString(runtimeEvents[0].occurred_at) : null,
  };
}

export function buildGreekPositionDiagnostics(
  input: GreekPositionDiagnosticsInput,
): GreekPositionDiagnostics {
  const enabled =
    input.profile.greekPositionManagementEnabled ||
    input.profile.wireGreekTrailEnabled;
  const positions = input.activePositions.map((position) => {
    const greek = position.greekManagement ?? null;
    const recommendation = compactString(greek?.recommendation) ?? "missing";
    return {
      symbol: position.symbol,
      lastMarkedAt: position.lastMarkedAt,
      lastMarkPrice: finiteNumber(position.lastMarkPrice),
      stopPrice: finiteNumber(position.stopPrice),
      recommendation,
      available: booleanOrNull(greek?.available),
      fresh: booleanOrNull(greek?.fresh),
      enforcing: booleanOrNull(greek?.enforcing),
      reasons: asArray(greek?.reasons).map(String),
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
    (position) => position.recommendation !== "missing" && position.fresh === true,
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
  if (value === null || value === undefined) return "";
  return String(value).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();
}

function numberCell(value: number | null, digits = 2): string {
  return value == null ? "" : value.toFixed(digits);
}

export function renderGreekPositionDiagnosticsMarkdown(
  diagnostics: GreekPositionDiagnostics,
): string {
  const summary = diagnostics.summary;
  const readyGate = greekPositionDiagnosticsReadyGate(diagnostics);
  return [
    "# Signal Options Greek Position Diagnostics",
    "",
    `- Generated: ${diagnostics.generatedAt}`,
    `- Deployment: ${diagnostics.deployment.name} (${diagnostics.deployment.id})`,
    `- Deployment enabled: ${diagnostics.deployment.enabled}`,
    `- Deployment updated at: ${diagnostics.deployment.updatedAt ?? "-"}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Status | ${diagnostics.status} |`,
    `| Ready gate passed | ${readyGate.passed} |`,
    `| Ready gate reason | ${readyGate.reason} |`,
    `| Greek diagnostics enabled | ${diagnostics.profile.greekPositionManagementEnabled} |`,
    `| Wire Greek trail enabled | ${diagnostics.profile.wireGreekTrailEnabled} |`,
    `| Active positions | ${summary.activePositions} |`,
    `| Positions with Greek management | ${summary.positionsWithGreekManagement} |`,
    `| Fresh Greek positions | ${summary.freshGreekPositions} |`,
    `| Stale/fallback Greek positions | ${summary.staleOrFallbackGreekPositions} |`,
    `| Recent events scanned | ${summary.recentEvents.total} |`,
    `| Recent mark events | ${summary.recentEvents.marks} |`,
    `| Recent marks with Greek management | ${summary.recentEvents.marksWithGreekManagement} |`,
    `| Latest mark at | ${summary.recentEvents.latestMarkAt ?? "-"} |`,
    `| Latest event at | ${summary.recentEvents.latestEventAt ?? "-"} |`,
    "",
    "## Recommendations",
    "",
    Object.keys(summary.recommendations).length
      ? [
          "| Recommendation | Positions |",
          "| --- | ---: |",
          ...Object.entries(summary.recommendations)
            .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
            .map(([recommendation, count]) => `| ${cell(recommendation)} | ${count} |`),
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

async function readDeployment(deploymentId: string | null) {
  const sql = deploymentId
    ? `
        select id, name, enabled, updated_at, config
        from algo_deployments
        where id = $1
        limit 1
      `
    : `
        select id, name, enabled, updated_at, config
        from algo_deployments
        where enabled = true
          and provider_account_id = 'shadow'
          and (
            name = 'Pyrus Signals Options Shadow Paper'
            or config->'parameters'->>'executionMode' = 'signal_options'
            or jsonb_typeof(config->'signalOptions') = 'object'
          )
        order by
          case when name = 'Pyrus Signals Options Shadow Paper' then 0 else 1 end,
          updated_at desc
        limit 1
      `;
  const result = await pool.query(sql, deploymentId ? [deploymentId] : []);
  const row = result.rows[0];
  if (!row) {
    throw new Error(
      deploymentId
        ? `No deployment found for ${deploymentId}.`
        : "No enabled shadow signal-options deployment found.",
    );
  }
  return row as {
    id: string;
    name: string;
    enabled: boolean;
    updated_at: Date | string | null;
    config: unknown;
  };
}

async function readRecentEvents(deploymentId: string, limit: number): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `
      select event_type, symbol, summary, payload, occurred_at
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

async function buildDiagnosticsFromDb(config: Config): Promise<GreekPositionDiagnostics> {
  const deployment = await readDeployment(config.deploymentId);
  const deploymentConfig = asRecord(deployment.config);
  const fallbackProfile = resolveSignalOptionsExecutionProfile(
    deploymentConfig.signalOptions ?? deploymentConfig,
  );
  const [state, events] = await Promise.all([
    listSignalOptionsAutomationState({
      deploymentId: deployment.id,
      view: "full",
    }),
    readRecentEvents(deployment.id, config.eventLimit),
  ]);
  const stateRecord = asRecord(state);
  const stateProfile = asRecord(stateRecord.profile);
  const profile = Object.keys(stateProfile).length
    ? resolveSignalOptionsExecutionProfile(stateProfile)
    : fallbackProfile;
  const activePositions = asArray(stateRecord.activePositions).map((value) => {
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
    generatedAt: new Date().toISOString(),
    deployment: {
      id: deployment.id,
      name: deployment.name,
      enabled: deployment.enabled,
      updatedAt: toIsoString(deployment.updated_at),
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

async function writeDiagnostics(
  diagnostics: GreekPositionDiagnostics,
  reportDir: string,
): Promise<void> {
  await mkdir(reportDir, { recursive: true });
  await Promise.all([
    writeFile(path.join(reportDir, "results.json"), `${JSON.stringify(diagnostics, null, 2)}\n`),
    writeFile(
      path.join(reportDir, "report.md"),
      `${renderGreekPositionDiagnosticsMarkdown(diagnostics)}\n`,
    ),
  ]);
}

async function main(): Promise<void> {
  const config = readConfig();
  const diagnostics = await buildDiagnosticsFromDb(config);
  const readyGate = greekPositionDiagnosticsReadyGate(diagnostics);
  await writeDiagnostics(diagnostics, config.reportDir);
  console.log(
    JSON.stringify(
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
      null,
      2,
    ),
  );
  if (config.requireReady && !readyGate.passed) {
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
