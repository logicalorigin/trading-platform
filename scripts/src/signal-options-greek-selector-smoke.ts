import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { scoreOptionGreekCandidate } from "@workspace/backtest-core";
import { pool } from "@workspace/db";
import {
  runSignalOptionsGreekSelectorSmoke,
  type SignalOptionsGreekSelectorSmokeCandidate,
  type SignalOptionsGreekSelectorSmokeResult,
} from "../../artifacts/api-server/src/services/signal-options-automation";
import { SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY } from "../../artifacts/api-server/src/services/signal-options-worker";
import {
  lookupHistoricalGreeks,
  readGexHistoricalGreeksToleranceMs,
  type GexHistoricalGreeksMatch,
  type HistoricalGreeksLookupResult,
} from "./gex-historical-greeks";

// The shadow backfill replays historical bars and refuses to run unless bar
// evaluation is opted in. This smoke is a historical replay, so enable it for
// this process only. `??=` lets a caller override.
process.env["PYRUS_SIGNAL_MONITOR_BAR_EVALUATION_ENABLED"] ??= "1";

type DeploymentRow = {
  id: string;
  name: string;
  mode: "shadow" | "live";
  symbolUniverse: unknown[];
};

type Config = {
  date: string;
  session: string;
  signalTimeframe: string;
  reportDir: string;
  maxSignals: number | null;
  maxCandidatesPerSignal: number;
  riskFreeRate: number;
  dividendYield: number;
  symbols: string[];
  gexToleranceMs: number;
  lockWaitMs: number;
  progress: boolean;
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
      reason: Exclude<HistoricalGreeksLookupResult, GexHistoricalGreeksMatch>["reason"];
    };

type SmokeCandidateWithGreekSource = SignalOptionsGreekSelectorSmokeCandidate & {
  greekSource?: GreekSourceMetadata;
};

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function readNumber(value: string | undefined | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPositiveInteger(
  value: string | undefined | null,
  fallback: number | null,
  max: number,
): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function readNonNegativeInteger(
  value: string | undefined | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(max, Math.floor(parsed));
}

function readConfig(): Config {
  const date =
    argValue("date") ??
    process.env["SIGNAL_OPTIONS_GREEK_SMOKE_DATE"] ??
    "2026-05-29";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("Use --date=YYYY-MM-DD or SIGNAL_OPTIONS_GREEK_SMOKE_DATE=YYYY-MM-DD.");
  }
  const reportRoot =
    argValue("report-dir") ??
    process.env["SIGNAL_OPTIONS_GREEK_SMOKE_REPORT_DIR"] ??
    path.join("reports", "signal-options-greek-selector-smoke", date);
  return {
    date,
    session:
      argValue("session") ??
      process.env["SIGNAL_OPTIONS_GREEK_SMOKE_SESSION"] ??
      "regular",
    signalTimeframe:
      argValue("signal-timeframe") ??
      process.env["SIGNAL_OPTIONS_GREEK_SMOKE_TIMEFRAME"] ??
      "5m",
    reportDir: path.resolve(process.cwd(), reportRoot),
    maxSignals: readPositiveInteger(
      argValue("max-signals") ?? process.env["SIGNAL_OPTIONS_GREEK_SMOKE_MAX_SIGNALS"],
      null,
      1_000,
    ),
    maxCandidatesPerSignal:
      readPositiveInteger(
        argValue("max-candidates-per-signal") ??
          process.env["SIGNAL_OPTIONS_GREEK_SMOKE_MAX_CANDIDATES_PER_SIGNAL"],
        24,
        200,
      ) ?? 24,
    riskFreeRate: readNumber(
      argValue("risk-free-rate") ?? process.env["SIGNAL_OPTIONS_GREEK_SMOKE_RISK_FREE_RATE"],
      0.05,
    ),
    dividendYield: readNumber(
      argValue("dividend-yield") ?? process.env["SIGNAL_OPTIONS_GREEK_SMOKE_DIVIDEND_YIELD"],
      0,
    ),
    symbols:
      (argValue("symbols") ?? process.env["SIGNAL_OPTIONS_GREEK_SMOKE_SYMBOLS"])
        ?.split(",")
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean) ?? [],
    gexToleranceMs: readNonNegativeInteger(
      argValue("gex-tolerance-ms") ??
        process.env["SIGNAL_OPTIONS_GEX_GREEKS_TOLERANCE_MS"],
      readGexHistoricalGreeksToleranceMs(),
      24 * 60 * 60_000,
    ),
    lockWaitMs: readPositiveInteger(
      argValue("lock-wait-ms") ?? process.env["SIGNAL_OPTIONS_GREEK_SMOKE_LOCK_WAIT_MS"],
      0,
      30 * 60_000,
    ) ?? 0,
    progress: readBooleanEnv("SIGNAL_OPTIONS_GREEK_SMOKE_PROGRESS", true),
  };
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "-" : `$${value.toFixed(2)}`;
}

function numberCell(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "-" : value.toFixed(digits);
}

function percentCell(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(digits)}%`;
}

function minutesCell(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "-" : `${(value / 60_000).toFixed(1)}m`;
}

function cell(value: unknown): string {
  return String(value ?? "-").replaceAll("|", "\\|").replace(/\s+/g, " ").trim() || "-";
}

function contractLabel(candidate: SignalOptionsGreekSelectorSmokeCandidate | null): string {
  if (!candidate) return "-";
  return `${candidate.expirationDate} ${candidate.right.toUpperCase()} ${candidate.strike}`;
}

function legacyContractLabel(
  legacy: SignalOptionsGreekSelectorSmokeResult["rows"][number]["legacy"],
): string {
  if (!legacy.expirationDate || !legacy.right || legacy.strike == null) return "-";
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
  return (candidate as SmokeCandidateWithGreekSource | null)?.greekSource ?? null;
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

function selectedGexSnapshotCount(result: SignalOptionsGreekSelectorSmokeResult): number {
  return result.rows.filter(
    (row) => candidateGreekSource(row.selected)?.source === "gex_snapshot",
  ).length;
}

function candidateGexSnapshotCount(result: SignalOptionsGreekSelectorSmokeResult): number {
  const seen = new Set<string>();
  let count = 0;
  for (const row of result.rows) {
    for (const candidate of [row.selected, ...row.topCandidates]) {
      if (!candidate) continue;
      const key = `${row.candidateId}:${candidate.ticker}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (candidateGreekSource(candidate)?.source === "gex_snapshot") count += 1;
    }
  }
  return count;
}

function noteCounts(result: SignalOptionsGreekSelectorSmokeResult): Array<[string, number]> {
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
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
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
    `- Generated: ${result.generatedAt}`,
    `- Date: ${result.date}`,
    `- Deployment: ${result.deployment.name} (${result.deployment.id})`,
    `- Window: ${String(result.window["from"] ?? "-")} to ${String(result.window["to"] ?? "-")}`,
    `- Timeframe: ${result.timeframe}`,
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
          skipReasons.map(([reason, count]) => `| ${cell(reason)} | ${count} |`).join("\n")
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
        .map((error) => `| ${cell(error.symbol ?? "-")} | ${cell(error.message)} |`),
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
      return Boolean(legacyTicker && selectedTicker && legacyTicker !== selectedTicker);
    }).length,
    totalLegacyPnl: Number(totalLegacyPnl.toFixed(2)),
    totalSelectedPnl: Number(totalSelectedPnl.toFixed(2)),
    totalPnlDelta: Number((totalSelectedPnl - totalLegacyPnl).toFixed(2)),
    totalSelectedMarkedPnl: Number(totalSelectedMarkedPnl.toFixed(2)),
    candidatesScored: rows.reduce((sum, row) => sum + row.candidatesScored, 0),
    candidatesSkipped: rows.reduce((sum, row) => sum + row.candidatesSkipped, 0),
    skipReasons: rows.reduce<Record<string, number>>((counts, row) => {
      for (const [reason, count] of Object.entries(row.skipReasons)) {
        counts[reason] = (counts[reason] ?? 0) + count;
      }
      return counts;
    }, {}),
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
) {
  let lookupCount = 0;
  let matchCount = 0;
  for (const row of result.rows) {
    for (const candidate of uniqueVisibleCandidates(row)) {
      lookupCount += 1;
      const lookup = await lookupHistoricalGreeks({
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

async function readSignalOptionsDeployment(): Promise<DeploymentRow> {
  const result = await pool.query<DeploymentRow>(
    `
      select id, name, mode, symbol_universe as "symbolUniverse"
      from algo_deployments
      where enabled = true
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
  if (!Array.isArray(deployment.symbolUniverse) || deployment.symbolUniverse.length < 1) {
    throw new Error(`Deployment ${deployment.id} has no symbols.`);
  }
  return deployment;
}

async function tryAcquireSignalOptionsWorkerLock() {
  const client = await pool.connect();
  try {
    const result = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock($1) as locked",
      [SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY],
    );
    if (result.rows[0]?.locked !== true) {
      client.release();
      return null;
    }
    return async () => {
      try {
        await client.query("select pg_advisory_unlock($1)", [
          SIGNAL_OPTIONS_WORKER_ADVISORY_LOCK_KEY,
        ]);
      } finally {
        client.release();
      }
    };
  } catch (error) {
    client.release();
    throw error;
  }
}

async function acquireSignalOptionsWorkerLock(waitMs: number) {
  const deadline = Date.now() + waitMs;
  let release = await tryAcquireSignalOptionsWorkerLock();
  while (!release && Date.now() < deadline) {
    await delay(Math.min(5_000, Math.max(0, deadline - Date.now())));
    release = await tryAcquireSignalOptionsWorkerLock();
  }
  return release;
}

async function main() {
  const config = readConfig();
  const releaseLock = await acquireSignalOptionsWorkerLock(config.lockWaitMs);
  if (!releaseLock) {
    throw new Error("Signal-options worker advisory lock is already held.");
  }

  try {
    const deployment = await readSignalOptionsDeployment();
    const requestedSymbols = new Set(config.symbols);
    const symbolUniverse = requestedSymbols.size
      ? deployment.symbolUniverse.filter((symbol) =>
          requestedSymbols.has(String(symbol).toUpperCase()),
        )
      : deployment.symbolUniverse;
    if (!symbolUniverse.length) {
      throw new Error(`No deployment symbols matched ${config.symbols.join(",")}.`);
    }

    const result = await runSignalOptionsGreekSelectorSmoke({
      deploymentId: deployment.id,
      date: config.date,
      session: config.session,
      signalTimeframe: config.signalTimeframe,
      forceDeploymentUniverse: true,
      symbolUniverseOverride: symbolUniverse.map((symbol) =>
        String(symbol).toUpperCase(),
      ),
      maxSignals: config.maxSignals,
      maxCandidatesPerSignal: config.maxCandidatesPerSignal,
      riskFreeRate: config.riskFreeRate,
      dividendYield: config.dividendYield,
      progress: config.progress,
    });
    (result.config as Record<string, unknown>)["gexToleranceMs"] = config.gexToleranceMs;
    await applyGexHistoricalGreeks(result, config);
    await mkdir(config.reportDir, { recursive: true });
    const reportPath = path.join(config.reportDir, "report.md");
    await writeFile(reportPath, renderGreekSelectorSmokeMarkdown(result));
    console.log(`wrote ${reportPath}`);
  } finally {
    await releaseLock();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
