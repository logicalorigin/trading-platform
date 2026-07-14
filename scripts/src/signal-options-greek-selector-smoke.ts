import { lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";
import { scoreOptionGreekCandidate } from "@workspace/backtest-core";
import {
  closeDatabaseConnections,
  pool,
  sharedAdvisoryLockHolder,
} from "@workspace/db";
import {
  runSignalOptionsGreekSelectorSmoke,
  type SignalOptionsGreekSelectorSmokeCandidate,
  type SignalOptionsGreekSelectorSmokeResult,
} from "../../artifacts/api-server/src/services/signal-options-automation";
import { SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY } from "../../artifacts/api-server/src/services/signal-options-worker";
import {
  DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS,
  lookupHistoricalGreeks,
  type GexHistoricalGreeksMatch,
  type HistoricalGreeksLookupResult,
} from "./gex-historical-greeks";

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow";
  enabled: true;
  providerAccountId: "shadow";
  config: unknown;
  symbolUniverse: string[];
};

type Config = {
  date: string;
  session: "regular" | "all";
  signalTimeframe: "1m" | "2m" | "5m" | "15m" | "1h" | "1d";
  reportDir: string;
  maxSignals: number | null;
  maxCandidatesPerSignal: number;
  riskFreeRate: number;
  dividendYield: number;
  symbols: string[];
  gexToleranceMs: number;
  lockWaitMs: number;
  progress: boolean;
  help: boolean;
};

type RawDeploymentRow = Omit<
  DeploymentRow,
  "mode" | "enabled" | "providerAccountId" | "symbolUniverse"
> & {
  mode: unknown;
  enabled: unknown;
  providerAccountId: unknown;
  symbolUniverse: unknown;
};

type SmokeDependencies = {
  acquireLock: (waitMs: number) => Promise<(() => Promise<void>) | null>;
  readDeployment: () => Promise<DeploymentRow>;
  runSmoke: typeof runSignalOptionsGreekSelectorSmoke;
  applyGex: typeof applyGexHistoricalGreeks;
  writeReport: typeof writeReport;
  log: (message: string) => void;
};

type GreekSourceMetadata =
  | {
      source: "gex_snapshot";
      computedAt: string;
      ageMs: number;
      snapshotId: string;
      sourceStatus: string | null;
    }
  | {
      source: "bs_reconstruction";
      reason: Exclude<
        HistoricalGreeksLookupResult,
        GexHistoricalGreeksMatch
      >["reason"];
    };

type SmokeCandidateWithGreekSource =
  SignalOptionsGreekSelectorSmokeCandidate & {
    greekSource?: GreekSourceMetadata;
  };

const DEFAULT_DATE = "2026-05-29";
const DEFAULT_MAX_CANDIDATES = 24;
const MAX_SIGNALS = 1_000;
const MAX_CANDIDATES = 200;
const MAX_GEX_TOLERANCE_MS = 24 * 60 * 60_000;
const MAX_LOCK_WAIT_MS = 30 * 60_000;
// ponytail: keep terminal failures compact; add a structured failure artifact
// before increasing this ceiling if operators need more diagnostic context.
const MAX_DIAGNOSTIC_LENGTH = 400;
const SIGNAL_TIMEFRAMES = ["1m", "2m", "5m", "15m", "1h", "1d"] as const;
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9./_-]{0,63}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const UNSAFE_JSON_OUTPUT_PATTERN =
  /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const USAGE = `Usage: pnpm --filter @workspace/scripts run signal-options:greek-selector-smoke -- [options]

Historical Greek-selector smoke report for one shadow signal-options deployment.

Options:
  --date=<YYYY-MM-DD>                 Historical market date (default: ${DEFAULT_DATE}).
  --session=<regular|all>             Historical session (default: regular).
  --signal-timeframe=<timeframe>      One of ${SIGNAL_TIMEFRAMES.join(", ")} (default: 5m).
  --report-dir=<path>                 New destination directory for report.md.
  --max-signals=<1-${MAX_SIGNALS}>              Optional action-signal cap (default: all).
  --max-candidates-per-signal=<1-${MAX_CANDIDATES}> Candidate cap (default: ${DEFAULT_MAX_CANDIDATES}).
  --risk-free-rate=<decimal>          Black-Scholes rate (default: 0.05).
  --dividend-yield=<decimal>          Black-Scholes dividend yield (default: 0).
  --symbols=<CSV>                     Restrict to deployment symbols.
  --gex-tolerance-ms=<0-${MAX_GEX_TOLERANCE_MS}> Historical GEX lookup tolerance.
  --lock-wait-ms=<0-${MAX_LOCK_WAIT_MS}>          Worker-lock wait (default: 0).
  -h, --help                          Show this help without database work.`;

function configError(message: string): Error {
  return new Error(`${message}\n\n${USAGE}`);
}

function nonEmptyEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return env[name]?.trim() || undefined;
}

function parseArguments(args: string[]) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseNodeArgs({
      args: normalizedArgs,
      options: {
        date: { type: "string" },
        session: { type: "string" },
        "signal-timeframe": { type: "string" },
        "report-dir": { type: "string" },
        "max-signals": { type: "string" },
        "max-candidates-per-signal": { type: "string" },
        "risk-free-rate": { type: "string" },
        "dividend-yield": { type: "string" },
        symbols: { type: "string" },
        "gex-tolerance-ms": { type: "string" },
        "lock-wait-ms": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const names = [
      "date",
      "session",
      "signal-timeframe",
      "report-dir",
      "max-signals",
      "max-candidates-per-signal",
      "risk-free-rate",
      "dividend-yield",
      "symbols",
      "gex-tolerance-ms",
      "lock-wait-ms",
      "help",
    ] as const;
    for (const name of names) {
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

function optionOrEnv(
  options: ReturnType<typeof parseArguments>,
  optionName: keyof ReturnType<typeof parseArguments>,
  env: NodeJS.ProcessEnv,
  envName: string,
): string | undefined {
  const option = options[optionName];
  if (typeof option === "string") {
    const value = option.trim();
    if (!value) throw configError(`--${String(optionName)} cannot be blank.`);
    return value;
  }
  return nonEmptyEnv(env, envName);
}

function canonicalDate(name: string, value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw configError(`${name} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw configError(`${name} must be a real YYYY-MM-DD date.`);
  }
  return value;
}

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (value === undefined) return fallback;
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw configError(
      `${name} must be a canonical integer from ${min} to ${max}.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw configError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return parsed;
}

function finiteDecimal(
  name: string,
  value: string | undefined,
  fallback: number,
): number {
  // ponytail: preserve the service's finite-only rate contract; define shared
  // economic bounds in the scorer/service before narrowing this command.
  if (value === undefined) return fallback;
  if (!DECIMAL_PATTERN.test(value)) {
    throw configError(`${name} must be a finite decimal number.`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw configError(`${name} must be a finite decimal number.`);
  }
  return parsed;
}

function booleanValue(name: string, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw configError(
    `${name} must be true or false (also accepts 1/0, yes/no, on/off).`,
  );
}

function readBooleanEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
): boolean {
  const value = nonEmptyEnv(env, name);
  return value === undefined ? fallback : booleanValue(name, value);
}

function symbolsValue(name: string, value: string | undefined): string[] {
  if (value === undefined) return [];
  const symbols = Array.from(
    new Set(
      value
        .split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
  if (
    !symbols.length ||
    symbols.some((symbol) => !SYMBOL_PATTERN.test(symbol))
  ) {
    throw configError(
      `${name} must be a comma-separated list of valid symbols.`,
    );
  }
  return symbols;
}

function defaultConfig(cwd: string): Config {
  return {
    date: DEFAULT_DATE,
    session: "regular",
    signalTimeframe: "5m",
    reportDir: path.resolve(
      cwd,
      "reports",
      "signal-options-greek-selector-smoke",
      DEFAULT_DATE,
    ),
    maxSignals: null,
    maxCandidatesPerSignal: DEFAULT_MAX_CANDIDATES,
    riskFreeRate: 0.05,
    dividendYield: 0,
    symbols: [],
    gexToleranceMs: DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS,
    lockWaitMs: 0,
    progress: true,
    help: false,
  };
}

function readConfig(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): Config {
  const options = parseArguments(args);
  if (options.help === true) return { ...defaultConfig(cwd), help: true };
  const date = canonicalDate(
    "--date / SIGNAL_OPTIONS_GREEK_SMOKE_DATE",
    optionOrEnv(options, "date", env, "SIGNAL_OPTIONS_GREEK_SMOKE_DATE") ??
      DEFAULT_DATE,
  );
  const session =
    optionOrEnv(
      options,
      "session",
      env,
      "SIGNAL_OPTIONS_GREEK_SMOKE_SESSION",
    ) ?? "regular";
  if (session !== "regular" && session !== "all") {
    throw configError(
      "--session / SIGNAL_OPTIONS_GREEK_SMOKE_SESSION must be regular or all.",
    );
  }
  const signalTimeframe =
    optionOrEnv(
      options,
      "signal-timeframe",
      env,
      "SIGNAL_OPTIONS_GREEK_SMOKE_TIMEFRAME",
    ) ?? "5m";
  if (
    !SIGNAL_TIMEFRAMES.includes(
      signalTimeframe as (typeof SIGNAL_TIMEFRAMES)[number],
    )
  ) {
    throw configError(
      `--signal-timeframe / SIGNAL_OPTIONS_GREEK_SMOKE_TIMEFRAME must be one of ${SIGNAL_TIMEFRAMES.join(", ")}.`,
    );
  }
  const reportRoot =
    optionOrEnv(
      options,
      "report-dir",
      env,
      "SIGNAL_OPTIONS_GREEK_SMOKE_REPORT_DIR",
    ) ?? path.join("reports", "signal-options-greek-selector-smoke", date);
  const maxSignalsValue = optionOrEnv(
    options,
    "max-signals",
    env,
    "SIGNAL_OPTIONS_GREEK_SMOKE_MAX_SIGNALS",
  );
  return {
    date,
    session,
    signalTimeframe: signalTimeframe as Config["signalTimeframe"],
    reportDir: path.resolve(cwd, reportRoot),
    maxSignals:
      maxSignalsValue === undefined
        ? null
        : boundedInteger("--max-signals", maxSignalsValue, 1, 1, MAX_SIGNALS),
    maxCandidatesPerSignal: boundedInteger(
      "--max-candidates-per-signal",
      optionOrEnv(
        options,
        "max-candidates-per-signal",
        env,
        "SIGNAL_OPTIONS_GREEK_SMOKE_MAX_CANDIDATES_PER_SIGNAL",
      ),
      DEFAULT_MAX_CANDIDATES,
      1,
      MAX_CANDIDATES,
    ),
    riskFreeRate: finiteDecimal(
      "--risk-free-rate",
      optionOrEnv(
        options,
        "risk-free-rate",
        env,
        "SIGNAL_OPTIONS_GREEK_SMOKE_RISK_FREE_RATE",
      ),
      0.05,
    ),
    dividendYield: finiteDecimal(
      "--dividend-yield",
      optionOrEnv(
        options,
        "dividend-yield",
        env,
        "SIGNAL_OPTIONS_GREEK_SMOKE_DIVIDEND_YIELD",
      ),
      0,
    ),
    symbols: symbolsValue(
      "--symbols / SIGNAL_OPTIONS_GREEK_SMOKE_SYMBOLS",
      optionOrEnv(
        options,
        "symbols",
        env,
        "SIGNAL_OPTIONS_GREEK_SMOKE_SYMBOLS",
      ),
    ),
    gexToleranceMs: boundedInteger(
      "--gex-tolerance-ms",
      optionOrEnv(
        options,
        "gex-tolerance-ms",
        env,
        "SIGNAL_OPTIONS_GEX_GREEKS_TOLERANCE_MS",
      ),
      DEFAULT_GEX_HISTORICAL_GREEKS_TOLERANCE_MS,
      0,
      MAX_GEX_TOLERANCE_MS,
    ),
    lockWaitMs: boundedInteger(
      "--lock-wait-ms",
      optionOrEnv(
        options,
        "lock-wait-ms",
        env,
        "SIGNAL_OPTIONS_GREEK_SMOKE_LOCK_WAIT_MS",
      ),
      0,
      0,
      MAX_LOCK_WAIT_MS,
    ),
    progress: readBooleanEnv(env, "SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS", true),
    help: false,
  };
}

function enableHistoricalBarEvaluation(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const primaryName = "PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  const aliasName = "SIGNAL_MONITOR_BAR_EVALUATION_ENABLED";
  const primaryValue = nonEmptyEnv(env, primaryName);
  const aliasValue = nonEmptyEnv(env, aliasName);
  const primary =
    primaryValue === undefined
      ? undefined
      : booleanValue(primaryName, primaryValue);
  const alias =
    aliasValue === undefined ? undefined : booleanValue(aliasName, aliasValue);
  if (primary !== undefined && alias !== undefined && primary !== alias) {
    throw configError(`Conflicting ${primaryName} and ${aliasName} values.`);
  }
  env[primaryName] = (primary ?? alias ?? true) ? "1" : "0";
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = stripVTControlCharacters(
    (raw || "Unknown Greek-selector smoke error")
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
      .replace(
        /([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)[?#][^\s]*/giu,
        "$1?[redacted]",
      ),
  )
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown Greek-selector smoke error";
  return diagnostic.length <= MAX_DIAGNOSTIC_LENGTH
    ? diagnostic
    : `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

function markdownText(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/([\\`*_[\]{}()#+!|~])/gu, "\\$1");
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

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "-"
    : `$${value.toFixed(2)}`;
}

function numberCell(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function percentCell(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value)
    ? "-"
    : `${(value * 100).toFixed(digits)}%`;
}

function minutesCell(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value)
    ? "-"
    : `${(value / 60_000).toFixed(1)}m`;
}

function cell(value: unknown): string {
  return (
    markdownText(value ?? "-")
      .replace(/\s+/gu, " ")
      .trim() || "-"
  );
}

function contractLabel(
  candidate: SignalOptionsGreekSelectorSmokeCandidate | null,
): string {
  if (!candidate) return "-";
  return `${candidate.expirationDate} ${candidate.right.toUpperCase()} ${candidate.strike}`;
}

function legacyContractLabel(
  legacy: SignalOptionsGreekSelectorSmokeResult["rows"][number]["legacy"],
): string {
  if (!legacy.expirationDate || !legacy.right || legacy.strike == null)
    return "-";
  return `${legacy.expirationDate} ${legacy.right.toUpperCase()} ${legacy.strike}`;
}

function outcomeLabel(
  outcome: SignalOptionsGreekSelectorSmokeResult["rows"][number]["outcome"],
): string {
  if (outcome === "closed_trade") return "Closed";
  if (outcome === "end_of_window_mark") return "EOD mark";
  return "Unmarked";
}

function candidateGreekSource(
  candidate: SignalOptionsGreekSelectorSmokeCandidate | null,
): GreekSourceMetadata | null {
  return (
    (candidate as SmokeCandidateWithGreekSource | null)?.greekSource ?? null
  );
}

function greekSourceLabel(
  candidate: SignalOptionsGreekSelectorSmokeCandidate | null,
): string {
  return candidateGreekSource(candidate)?.source ?? "bs_reconstruction";
}

function greekSourceAgeMs(
  candidate: SignalOptionsGreekSelectorSmokeCandidate | null,
): number | null {
  const source = candidateGreekSource(candidate);
  return source?.source === "gex_snapshot" ? source.ageMs : null;
}

function selectedGexSnapshotCount(
  result: SignalOptionsGreekSelectorSmokeResult,
): number {
  return result.rows.filter(
    (row) => candidateGreekSource(row.selected)?.source === "gex_snapshot",
  ).length;
}

function candidateGexSnapshotCount(
  result: SignalOptionsGreekSelectorSmokeResult,
): number {
  const seen = new Set<string>();
  let count = 0;
  for (const row of result.rows) {
    for (const candidate of [row.selected, ...row.topCandidates]) {
      if (!candidate) continue;
      const key = `${row.candidateId}:${candidate.ticker}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidateGreekSource(candidate)?.source === "gex_snapshot")
        count += 1;
    }
  }
  return count;
}

function noteCounts(
  result: SignalOptionsGreekSelectorSmokeResult,
): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of result.rows) {
    for (const note of row.notes) {
      counts.set(note, (counts.get(note) ?? 0) + 1);
    }
    for (const candidate of row.topCandidates) {
      for (const note of candidate.score.notes) {
        counts.set(note, (counts.get(note) ?? 0) + 1);
      }
    }
  }
  return Array.from(counts.entries()).sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  );
}

function skipReasonCounts(
  result: SignalOptionsGreekSelectorSmokeResult,
): Array<[string, number]> {
  return Object.entries(result.summary.skipReasons)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    );
}

export function renderGreekSelectorSmokeMarkdown(
  result: SignalOptionsGreekSelectorSmokeResult,
): string {
  const summary = result.summary;
  const rows = result.rows.map((row) => [
    row.signalAt,
    row.symbol,
    row.direction.toUpperCase(),
    outcomeLabel(row.outcome),
    money(row.underlyingPrice),
    legacyContractLabel(row.legacy),
    contractLabel(row.selected),
    greekSourceLabel(row.selected),
    minutesCell(greekSourceAgeMs(row.selected)),
    numberCell(row.selected?.score.total, 1),
    row.selected ? percentCell(row.selected.greeks.impliedVolatility) : "-",
    row.selected ? numberCell(row.selected.greeks.delta, 3) : "-",
    row.selected ? numberCell(row.selected.greeks.gamma, 4) : "-",
    row.selected ? numberCell(row.selected.greeks.theta, 3) : "-",
    money(row.legacy.pnl),
    money(row.selected?.pnl),
    money(row.pnlDelta),
    `${row.candidatesScored}/${row.candidatesScored + row.candidatesSkipped}`,
  ]);
  const skipReasons = skipReasonCounts(result).slice(0, 20);
  const notes = noteCounts(result).slice(0, 12);
  const lines = [
    "# Signal Options Greek Selector Smoke Test",
    "",
    `- Generated: ${markdownText(result.generatedAt)}`,
    `- Date: ${markdownText(result.date)}`,
    `- Deployment: ${markdownText(result.deployment.name)} (${markdownText(result.deployment.id)})`,
    `- Window: ${markdownText(result.window["from"] ?? "-")} to ${markdownText(result.window["to"] ?? "-")}`,
    `- Timeframe: ${markdownText(result.timeframe)}`,
    `- Max signals: ${result.config.maxSignals ?? "all"}`,
    `- Max candidates per signal: ${result.config.maxCandidatesPerSignal}`,
    `- Risk-free rate: ${percentCell(result.config.riskFreeRate)}`,
    `- Dividend yield: ${percentCell(result.config.dividendYield)}`,
    `- GEX tolerance: ${minutesCell(finiteNumber((result.config as Record<string, unknown>)["gexToleranceMs"]))}`,
    "- Greek source: `gex_snapshots` exact-contract lookup when available; Black-Scholes reconstruction fallback",
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Action candidates | ${summary.actionCandidates} |`,
    `| Reported signals | ${summary.reportedSignals} |`,
    `| Legacy closed trades | ${summary.legacyClosedTrades} |`,
    `| Closed trades compared | ${summary.comparedSignals} |`,
    `| Changed selections | ${summary.changedSelections} |`,
    `| Legacy PnL | ${money(summary.totalLegacyPnl)} |`,
    `| Greek-selected PnL | ${money(summary.totalSelectedPnl)} |`,
    `| PnL delta | ${money(summary.totalPnlDelta)} |`,
    `| Greek-selected marked PnL | ${money(summary.totalSelectedMarkedPnl)} |`,
    `| Rows with Greek selection | ${summary.rowsWithSelection} |`,
    `| Rows with marked PnL | ${summary.rowsWithMarkedPnl} |`,
    `| Candidates scored | ${summary.candidatesScored} |`,
    `| Visible candidates with gex_snapshot greeks | ${candidateGexSnapshotCount(result)} |`,
    `| Selected rows with gex_snapshot greeks | ${selectedGexSnapshotCount(result)} |`,
    `| Candidates skipped | ${summary.candidatesSkipped} |`,
    `| Rows without selection | ${summary.rowsWithoutSelection} |`,
    "",
    "## Skip Reasons",
    "",
    skipReasons.length
      ? "| Reason | Count |\n| --- | ---: |\n" +
        skipReasons
          .map(([reason, count]) => `| ${cell(reason)} | ${count} |`)
          .join("\n")
      : "No skipped candidates.",
    "",
    "## Per-Signal Results",
    "",
    "| Signal At | Symbol | Side | Outcome | Underlying | Legacy Contract | Greek Contract | Source | Source Age | Score | IV | Delta | Gamma | Theta | Legacy PnL | Greek PnL | Delta | Scored/Total |",
    "| --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
    "",
    "## Notes",
    "",
    notes.length
      ? "| Note | Count |\n| --- | ---: |\n" +
        notes.map(([note, count]) => `| ${cell(note)} | ${count} |`).join("\n")
      : "No recurring notes.",
  ];
  if (result.errors.length) {
    lines.push(
      "",
      "## Data Gaps",
      "",
      "| Symbol | Message |",
      "| --- | --- |",
      ...result.errors
        .slice(0, 50)
        .map(
          (error) =>
            `| ${cell(error.symbol ?? "-")} | ${cell(error.message)} |`,
        ),
    );
  }
  return `${lines.join("\n")}\n`;
}

function summarizeGreekSelectorSmokeRows(
  actionCandidates: number,
  legacyClosedTrades: number,
  rows: SignalOptionsGreekSelectorSmokeResult["rows"],
): SignalOptionsGreekSelectorSmokeResult["summary"] {
  const comparableRows = rows.filter((row) => row.pnlDelta != null);
  const markedRows = rows.filter((row) => row.selected?.pnl != null);
  const totalLegacyPnl = comparableRows.reduce(
    (sum, row) => sum + (row.legacy.pnl ?? 0),
    0,
  );
  const totalSelectedPnl = comparableRows.reduce(
    (sum, row) => sum + (row.selected?.pnl ?? 0),
    0,
  );
  const totalSelectedMarkedPnl = markedRows.reduce(
    (sum, row) => sum + (row.selected?.pnl ?? 0),
    0,
  );
  return {
    actionCandidates,
    reportedSignals: rows.length,
    legacyClosedTrades,
    comparedSignals: comparableRows.length,
    changedSelections: rows.filter((row) => {
      const legacyTicker = row.legacy.ticker;
      const selectedTicker = row.selected?.ticker ?? null;
      return Boolean(
        legacyTicker && selectedTicker && legacyTicker !== selectedTicker,
      );
    }).length,
    totalLegacyPnl: Number(totalLegacyPnl.toFixed(2)),
    totalSelectedPnl: Number(totalSelectedPnl.toFixed(2)),
    totalPnlDelta: Number((totalSelectedPnl - totalLegacyPnl).toFixed(2)),
    totalSelectedMarkedPnl: Number(totalSelectedMarkedPnl.toFixed(2)),
    candidatesScored: rows.reduce((sum, row) => sum + row.candidatesScored, 0),
    candidatesSkipped: rows.reduce(
      (sum, row) => sum + row.candidatesSkipped,
      0,
    ),
    skipReasons: Object.fromEntries(
      rows.reduce<Map<string, number>>((counts, row) => {
        for (const [reason, count] of Object.entries(row.skipReasons)) {
          if (Number.isFinite(count)) {
            counts.set(reason, (counts.get(reason) ?? 0) + count);
          }
        }
        return counts;
      }, new Map()),
    ),
    rowsWithSelection: rows.filter((row) => row.selected).length,
    rowsWithMarkedPnl: markedRows.length,
    rowsWithoutSelection: rows.filter((row) => !row.selected).length,
  };
}

function uniqueVisibleCandidates(
  row: SignalOptionsGreekSelectorSmokeResult["rows"][number],
): SignalOptionsGreekSelectorSmokeCandidate[] {
  const seen = new Set<string>();
  const candidates: SignalOptionsGreekSelectorSmokeCandidate[] = [];
  for (const candidate of [row.selected, ...row.topCandidates]) {
    if (!candidate) continue;
    const key = `${candidate.ticker}:${candidate.entryAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(candidate);
  }
  return candidates;
}

function applyGreekLookupToCandidate(input: {
  row: SignalOptionsGreekSelectorSmokeResult["rows"][number];
  candidate: SignalOptionsGreekSelectorSmokeCandidate;
  lookup: HistoricalGreeksLookupResult;
}) {
  const candidateWithSource = input.candidate as SmokeCandidateWithGreekSource;
  if (input.lookup.source === "gex_snapshot") {
    const spot = input.row.underlyingPrice ?? input.lookup.spot;
    input.candidate.greeks = input.lookup.greeks;
    if (spot != null && Number.isFinite(spot)) {
      input.candidate.score = scoreOptionGreekCandidate({
        right: input.candidate.right,
        spot,
        strike: input.candidate.strike,
        entryPrice: input.candidate.entryPrice,
        volume: input.candidate.volume,
        hasExitPrice: input.candidate.exitPrice != null,
        greeks: input.lookup.greeks,
      });
    }
    candidateWithSource.greekSource = {
      source: "gex_snapshot",
      computedAt: input.lookup.computedAt,
      ageMs: input.lookup.ageMs,
      snapshotId: input.lookup.snapshotId,
      sourceStatus: input.lookup.sourceStatus,
    };
    return;
  }
  candidateWithSource.greekSource = {
    source: "bs_reconstruction",
    reason: input.lookup.reason,
  };
}

async function applyGexHistoricalGreeks(
  result: SignalOptionsGreekSelectorSmokeResult,
  config: Pick<Config, "gexToleranceMs" | "progress">,
  lookupGreeks: typeof lookupHistoricalGreeks = lookupHistoricalGreeks,
) {
  let lookupCount = 0;
  let matchCount = 0;
  for (const row of result.rows) {
    for (const candidate of uniqueVisibleCandidates(row)) {
      lookupCount += 1;
      const lookup = await lookupGreeks({
        symbol: row.symbol,
        expirationDate: candidate.expirationDate,
        strike: candidate.strike,
        right: candidate.right,
        timestamp: new Date(candidate.entryAt),
        toleranceMs: config.gexToleranceMs,
        fallbackGreeks: candidate.greeks,
      });
      if (lookup.source === "gex_snapshot") matchCount += 1;
      applyGreekLookupToCandidate({ row, candidate, lookup });
    }
    row.topCandidates = row.topCandidates
      .slice()
      .sort(
        (left, right) =>
          right.score.total - left.score.total ||
          (right.pnl ?? Number.NEGATIVE_INFINITY) -
            (left.pnl ?? Number.NEGATIVE_INFINITY) ||
          left.ticker.localeCompare(right.ticker),
      );
    row.selected = row.topCandidates[0] ?? row.selected;
    row.pnlDelta =
      row.selected?.pnl != null && row.legacy.pnl != null
        ? Number((row.selected.pnl - row.legacy.pnl).toFixed(2))
        : null;
  }
  Object.assign(
    result.summary,
    summarizeGreekSelectorSmokeRows(
      result.summary.actionCandidates,
      result.summary.legacyClosedTrades,
      result.rows,
    ),
  );
  if (config.progress) {
    console.log(
      `[signal-options-greek-smoke] gex lookup matched ${matchCount}/${lookupCount} visible candidates toleranceMs=${config.gexToleranceMs}`,
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function validateDeployment(value: unknown): DeploymentRow {
  const row = asRecord(value);
  const id =
    typeof row["id"] === "string" ? row["id"].trim().toLowerCase() : "";
  const name = typeof row["name"] === "string" ? row["name"].trim() : "";
  if (!UUID_PATTERN.test(id) || !name) {
    throw new Error(
      "Invalid deployment row: expected a valid deployment ID and name.",
    );
  }
  if (
    row["mode"] !== "shadow" ||
    row["enabled"] !== true ||
    row["providerAccountId"] !== "shadow" ||
    (name !== "Pyrus Signals Options Shadow" &&
      asRecord(asRecord(row["config"])["parameters"])["executionMode"] !==
        "signal_options")
  ) {
    throw new Error(
      `Deployment ${id} is not an enabled shadow signal-options deployment.`,
    );
  }
  const rawSymbols = row["symbolUniverse"];
  if (!Array.isArray(rawSymbols) || !rawSymbols.length) {
    throw new Error(`Deployment ${id} has no symbols.`);
  }
  const symbolUniverse: string[] = [];
  const seen = new Set<string>();
  for (const value of rawSymbols) {
    const symbol = typeof value === "string" ? value.trim().toUpperCase() : "";
    if (!SYMBOL_PATTERN.test(symbol)) {
      throw new Error(`Deployment ${id} has invalid symbols.`);
    }
    if (!seen.has(symbol)) {
      seen.add(symbol);
      symbolUniverse.push(symbol);
    }
  }
  return {
    id,
    name,
    mode: "shadow",
    enabled: true,
    providerAccountId: "shadow",
    config: row["config"],
    symbolUniverse,
  };
}

async function readSignalOptionsDeployment(): Promise<DeploymentRow> {
  const result = await pool.query<RawDeploymentRow>(
    `
      select
        id,
        name,
        mode,
        enabled,
        provider_account_id as "providerAccountId",
        config,
        symbol_universe as "symbolUniverse"
      from algo_deployments
      where enabled = true
        and mode = 'shadow'
        and provider_account_id = 'shadow'
        and (
          name = 'Pyrus Signals Options Shadow'
          or config->'parameters'->>'executionMode' = 'signal_options'
        )
      order by
        case when name = 'Pyrus Signals Options Shadow' then 0 else 1 end,
        updated_at desc
      limit 1
    `,
  );
  const deployment = result.rows[0];
  if (!deployment) {
    throw new Error("No enabled shadow signal-options deployment found.");
  }
  return validateDeployment(deployment);
}

function selectSymbolUniverse(
  deploymentSymbols: readonly string[],
  requestedSymbols: readonly string[],
): string[] {
  if (!requestedSymbols.length) return [...deploymentSymbols];
  const requested = new Set(
    requestedSymbols.map((symbol) => symbol.toUpperCase()),
  );
  const selected = deploymentSymbols.filter((symbol) => requested.has(symbol));
  if (!selected.length) {
    throw new Error(
      `No deployment symbols matched ${requestedSymbols.join(",")}.`,
    );
  }
  return selected;
}

async function acquireSignalOptionsWorkerLock(waitMs: number) {
  const deadline = Date.now() + waitMs;
  let release = await sharedAdvisoryLockHolder.acquire(
    SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
  );
  while (!release && Date.now() < deadline) {
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    release = await sharedAdvisoryLockHolder.acquire(
      SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
    );
  }
  return release;
}

async function assertReportDestinationAvailable(
  reportDir: string,
): Promise<void> {
  try {
    await lstat(reportDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Report destination already exists: ${reportDir}`);
}

async function writeReport(
  result: SignalOptionsGreekSelectorSmokeResult,
  reportDir: string,
): Promise<string> {
  await assertReportDestinationAvailable(reportDir);
  const parent = path.dirname(reportDir);
  await mkdir(parent, { recursive: true });
  const temporaryDir = await mkdtemp(
    path.join(parent, `.${path.basename(reportDir)}.tmp-`),
  );
  try {
    await writeFile(
      path.join(temporaryDir, "report.md"),
      renderGreekSelectorSmokeMarkdown(result),
    );
    await rename(temporaryDir, reportDir);
  } catch (error) {
    await rm(temporaryDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return path.join(reportDir, "report.md");
}

const defaultSmokeDependencies: SmokeDependencies = {
  acquireLock: acquireSignalOptionsWorkerLock,
  readDeployment: readSignalOptionsDeployment,
  runSmoke: runSignalOptionsGreekSelectorSmoke,
  applyGex: applyGexHistoricalGreeks,
  writeReport,
  log: (message) => console.error(message),
};

async function executeSmoke(
  config: Config,
  dependencies: SmokeDependencies = defaultSmokeDependencies,
): Promise<string> {
  const releaseLock = await dependencies.acquireLock(config.lockWaitMs);
  if (!releaseLock) {
    throw new Error("Signal-options worker advisory lock is already held.");
  }

  let failed = false;
  try {
    const deployment = await dependencies.readDeployment();
    const symbolUniverse = selectSymbolUniverse(
      deployment.symbolUniverse,
      config.symbols,
    );
    const result = await dependencies.runSmoke({
      deploymentId: deployment.id,
      date: config.date,
      session: config.session,
      signalTimeframe: config.signalTimeframe,
      forceDeploymentUniverse: true,
      symbolUniverseOverride: symbolUniverse,
      maxSignals: config.maxSignals,
      maxCandidatesPerSignal: config.maxCandidatesPerSignal,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      progress: config.progress,
    });
    (result.config as Record<string, unknown>)["gexToleranceMs"] =
      config.gexToleranceMs;
    await dependencies.applyGex(result, config);
    return await dependencies.writeReport(result, config.reportDir);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await releaseLock();
    } catch (error) {
      if (!failed) throw error;
      try {
        dependencies.log("Signal-options worker lock cleanup failed.");
      } catch {
        // Preserve the primary smoke failure even if a custom logger fails.
      }
    }
  }
}

async function main(
  args: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  dependencies: SmokeDependencies = defaultSmokeDependencies,
): Promise<number> {
  const config = readConfig(args, env, cwd);
  if (config.help) {
    console.log(USAGE);
    return 0;
  }
  await assertReportDestinationAvailable(config.reportDir);
  enableHistoricalBarEvaluation(env);
  const reportPath = await executeSmoke(config, dependencies);
  console.log(jsonText({ reportPath }));
  return 0;
}

async function runCli(): Promise<void> {
  let exitCode = 0;
  let failed = false;
  try {
    exitCode = await main();
  } catch (error) {
    failed = true;
    console.error(safeDiagnostic(error));
    exitCode = 1;
  }
  try {
    await closeDatabaseConnections();
  } catch (error) {
    console.error(
      failed
        ? "Database cleanup also failed."
        : `Database cleanup failed: ${safeDiagnostic(error)}`,
    );
    exitCode = 1;
  }
  process.exitCode = exitCode;
}

export const __signalOptionsGreekSelectorSmokeInternalsForTests = {
  applyGexHistoricalGreeks,
  assertReportDestinationAvailable,
  enableHistoricalBarEvaluation,
  executeSmoke,
  readConfig,
  safeDiagnostic,
  selectSymbolUniverse,
  validateDeployment,
  writeReport,
};

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}
