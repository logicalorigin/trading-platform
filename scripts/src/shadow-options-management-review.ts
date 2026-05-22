import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";

type JsonRecord = Record<string, unknown>;

type Config = {
  accountId: string;
  start: string;
  end: string;
  reportDir: string;
  topLeaks: number;
  sweepRoot: string;
};

type LedgerSummary = {
  fills: number;
  buyFills: number;
  sellFills: number;
  symbols: number;
  firstFillAt: string | null;
  lastFillAt: string | null;
  realizedPnl: number;
  fees: number;
  cashDelta: number;
};

type AggregateRow = {
  bucket: string;
  exits: number;
  wins: number;
  winPct: number | null;
  pnl: number;
  avgPnl: number | null;
  missedToPostExitHigh: number;
  reached25AfterExit: number;
  finalAboveExit: number;
};

type SymbolRow = {
  symbol: string;
  exits: number;
  wins: number;
  winPct: number | null;
  pnl: number;
  avgPnl: number | null;
  missedToPostExitHigh: number;
};

type LeakRow = {
  symbol: string;
  reason: string;
  closedAt: string;
  pnl: number;
  quantity: number;
  entryPrice: number | null;
  exitPrice: number;
  peakPrice: number | null;
  postHigh: number | null;
  highVsExitPct: number | null;
  missedToHigh: number;
  holdMinutes: number | null;
  score: number | null;
  mtfMatches: number | null;
  adx: number | null;
  premiumAtRisk: number | null;
  finalAboveExit: boolean | null;
  recoveredEntry: boolean | null;
};

type SweepEvidence = {
  reportDir: string;
  window: string | null;
  bestVariant: string | null;
  bestPnl: number | null;
  bestProfitFactor: number | null;
  bestTrades: number | null;
  bestWinPct: number | null;
  bestMaxDrawdown: number | null;
};

type Recommendation = {
  lane: "exit_management" | "sizing" | "entry_filtering" | "portfolio" | "data_quality";
  priority: "high" | "medium" | "low";
  title: string;
  evidence: string;
  nextTest: string;
};

type ReviewOutput = {
  summary: {
    generatedAt: string;
    accountId: string;
    window: { start: string; end: string };
    reportDir: string;
    ledger: LedgerSummary;
    opportunity: {
      realizedExitPnl: number;
      missedToPostExitHigh: number;
      missedToRealizedRatio: number | null;
      caveat: string;
    };
  };
  byMonth: AggregateRow[];
  byExitReason: AggregateRow[];
  byQuality: AggregateRow[];
  topSymbols: SymbolRow[];
  weakSymbols: SymbolRow[];
  topLeaks: LeakRow[];
  sweepEvidence: SweepEvidence[];
  recommendations: Recommendation[];
};

function slug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readPositiveIntegerEnv(name: string, fallback: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(max, Math.floor(value));
}

function readConfig(): Config {
  const reportRoot =
    process.env["SHADOW_OPTIONS_MANAGEMENT_REVIEW_REPORT_DIR"] ??
    path.join("reports", "shadow-options-management-review", slug());
  return {
    accountId: process.env["SHADOW_OPTIONS_MANAGEMENT_REVIEW_ACCOUNT_ID"] ?? "shadow",
    start: process.env["SHADOW_OPTIONS_MANAGEMENT_REVIEW_START"] ?? "2026-04-01",
    end: process.env["SHADOW_OPTIONS_MANAGEMENT_REVIEW_END"] ?? "2026-05-21",
    reportDir: path.resolve(process.cwd(), reportRoot),
    topLeaks: readPositiveIntegerEnv("SHADOW_OPTIONS_MANAGEMENT_REVIEW_TOP_LEAKS", 30, 250),
    sweepRoot: path.resolve(
      process.cwd(),
      process.env["SHADOW_OPTIONS_MANAGEMENT_REVIEW_SWEEP_ROOT"] ??
        path.join("reports", "signal-options-exit-policy-sweeps"),
    ),
  };
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, decimals = 2): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function sqlWindow(config: Config) {
  return {
    from: `${config.start}T00:00:00.000Z`,
    to: `${config.end}T23:59:59.999Z`,
  };
}

function normalizeAggregateRow(row: Record<string, unknown>): AggregateRow {
  return {
    bucket: String(row["bucket"] ?? "unknown"),
    exits: Number(row["exits"] ?? 0),
    wins: Number(row["wins"] ?? 0),
    winPct: round(finiteNumber(row["win_pct"]), 1),
    pnl: round(finiteNumber(row["pnl"]) ?? 0, 2) ?? 0,
    avgPnl: round(finiteNumber(row["avg_pnl"]), 2),
    missedToPostExitHigh: round(finiteNumber(row["missed_to_post_exit_high"]) ?? 0, 2) ?? 0,
    reached25AfterExit: Number(row["reached_25_after_exit"] ?? 0),
    finalAboveExit: Number(row["final_above_exit"] ?? 0),
  };
}

function normalizeSymbolRow(row: Record<string, unknown>): SymbolRow {
  return {
    symbol: String(row["symbol"] ?? "unknown"),
    exits: Number(row["exits"] ?? 0),
    wins: Number(row["wins"] ?? 0),
    winPct: round(finiteNumber(row["win_pct"]), 1),
    pnl: round(finiteNumber(row["pnl"]) ?? 0, 2) ?? 0,
    avgPnl: round(finiteNumber(row["avg_pnl"]), 2),
    missedToPostExitHigh: round(finiteNumber(row["missed_to_post_exit_high"]) ?? 0, 2) ?? 0,
  };
}

async function loadLedgerSummary(config: Config): Promise<LedgerSummary> {
  const window = sqlWindow(config);
  const result = await pool.query(
    `
      select count(*)::int as fills,
             count(*) filter (where f.side = 'buy')::int as buy_fills,
             count(*) filter (where f.side = 'sell')::int as sell_fills,
             count(distinct f.symbol)::int as symbols,
             min(f.occurred_at) as first_fill_at,
             max(f.occurred_at) as last_fill_at,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as realized_pnl,
             coalesce(sum(f.fees), 0)::numeric(18,2) as fees,
             coalesce(sum(f.cash_delta), 0)::numeric(18,2) as cash_delta
      from shadow_fills f
      join shadow_orders o on o.id = f.order_id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and f.occurred_at >= $2::timestamptz
        and f.occurred_at <= $3::timestamptz
    `,
    [config.accountId, window.from, window.to],
  );
  const row = result.rows[0] ?? {};
  return {
    fills: Number(row.fills ?? 0),
    buyFills: Number(row.buy_fills ?? 0),
    sellFills: Number(row.sell_fills ?? 0),
    symbols: Number(row.symbols ?? 0),
    firstFillAt: row.first_fill_at instanceof Date ? row.first_fill_at.toISOString() : null,
    lastFillAt: row.last_fill_at instanceof Date ? row.last_fill_at.toISOString() : null,
    realizedPnl: round(finiteNumber(row.realized_pnl) ?? 0, 2) ?? 0,
    fees: round(finiteNumber(row.fees) ?? 0, 2) ?? 0,
    cashDelta: round(finiteNumber(row.cash_delta) ?? 0, 2) ?? 0,
  };
}

async function loadAggregate(config: Config, bucketSql: string): Promise<AggregateRow[]> {
  const window = sqlWindow(config);
  const result = await pool.query(
    `
      select ${bucketSql} as bucket,
             count(*)::int as exits,
             count(*) filter (where f.realized_pnl > 0)::int as wins,
             (count(*) filter (where f.realized_pnl > 0)::numeric / nullif(count(*), 0) * 100)::numeric(18,1) as win_pct,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as pnl,
             avg(f.realized_pnl)::numeric(18,2) as avg_pnl,
             coalesce(sum(greatest(((o.payload #>> '{postExitOutcome,highPrice}')::numeric - f.price) * f.quantity * 100, 0)), 0)::numeric(18,2) as missed_to_post_exit_high,
             count(*) filter (where (o.payload #>> '{postExitOutcome,reachedTwentyFivePctGain}')::boolean is true)::int as reached_25_after_exit,
             count(*) filter (where (o.payload #>> '{postExitOutcome,finalAboveExit}')::boolean is true)::int as final_above_exit
      from shadow_orders o
      join shadow_fills f on f.order_id = o.id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and o.side = 'sell'
        and o.placed_at >= $2::timestamptz
        and o.placed_at <= $3::timestamptz
      group by 1
      order by pnl desc
    `,
    [config.accountId, window.from, window.to],
  );
  return result.rows.map(normalizeAggregateRow);
}

async function loadSymbols(config: Config, order: "best" | "worst"): Promise<SymbolRow[]> {
  const window = sqlWindow(config);
  const result = await pool.query(
    `
      select o.symbol,
             count(*)::int as exits,
             count(*) filter (where f.realized_pnl > 0)::int as wins,
             (count(*) filter (where f.realized_pnl > 0)::numeric / nullif(count(*), 0) * 100)::numeric(18,1) as win_pct,
             coalesce(sum(f.realized_pnl), 0)::numeric(18,2) as pnl,
             avg(f.realized_pnl)::numeric(18,2) as avg_pnl,
             coalesce(sum(greatest(((o.payload #>> '{postExitOutcome,highPrice}')::numeric - f.price) * f.quantity * 100, 0)), 0)::numeric(18,2) as missed_to_post_exit_high
      from shadow_orders o
      join shadow_fills f on f.order_id = o.id
      where o.account_id = $1
        and o.source = 'automation'
        and o.asset_class = 'option'
        and o.side = 'sell'
        and o.placed_at >= $2::timestamptz
        and o.placed_at <= $3::timestamptz
      group by 1
      having count(*) >= 3
      order by pnl ${order === "best" ? "desc" : "asc"}
      limit 20
    `,
    [config.accountId, window.from, window.to],
  );
  return result.rows.map(normalizeSymbolRow);
}

async function loadTopLeaks(config: Config): Promise<LeakRow[]> {
  const window = sqlWindow(config);
  const result = await pool.query(
    `
      with sells as (
        select o.symbol,
               coalesce(o.payload->>'reason', 'unknown') as reason,
               o.placed_at as closed_at,
               f.realized_pnl,
               f.quantity,
               f.price as exit_price,
               (o.payload #>> '{position,entryPrice}')::numeric as entry_price,
               (o.payload #>> '{position,peakPrice}')::numeric as peak_price,
               (o.payload #>> '{postExitOutcome,highPrice}')::numeric as post_high,
               (o.payload #>> '{postExitOutcome,highVsExitPct}')::numeric as high_vs_exit_pct,
               (o.payload #>> '{postExitOutcome,finalAboveExit}')::boolean as final_above_exit,
               (o.payload #>> '{postExitOutcome,recoveredEntry}')::boolean as recovered_entry,
               (o.payload #>> '{position,signalQuality,score}')::numeric as score,
               (o.payload #>> '{position,signalQuality,mtfMatches}')::int as mtf_matches,
               (o.payload #>> '{position,signalQuality,adx}')::numeric as adx,
               (o.payload #>> '{position,premiumAtRisk}')::numeric as premium_at_risk,
               (o.payload #>> '{position,openedAt}')::timestamptz as opened_at
        from shadow_orders o
        join shadow_fills f on f.order_id = o.id
        where o.account_id = $1
          and o.source = 'automation'
          and o.asset_class = 'option'
          and o.side = 'sell'
          and o.placed_at >= $2::timestamptz
          and o.placed_at <= $3::timestamptz
      )
      select symbol,
             reason,
             closed_at,
             realized_pnl::numeric(18,2) as pnl,
             quantity::numeric(18,2) as quantity,
             entry_price,
             exit_price,
             peak_price,
             post_high,
             high_vs_exit_pct,
             greatest((post_high - exit_price) * quantity * 100, 0)::numeric(18,2) as missed_to_high,
             (extract(epoch from (closed_at - opened_at)) / 60)::numeric(18,1) as hold_minutes,
             score,
             mtf_matches,
             adx,
             premium_at_risk,
             final_above_exit,
             recovered_entry
      from sells
      order by missed_to_high desc
      limit $4
    `,
    [config.accountId, window.from, window.to, config.topLeaks],
  );
  return result.rows.map((row) => ({
    symbol: String(row.symbol),
    reason: String(row.reason),
    closedAt: row.closed_at instanceof Date ? row.closed_at.toISOString() : String(row.closed_at),
    pnl: round(finiteNumber(row.pnl) ?? 0, 2) ?? 0,
    quantity: finiteNumber(row.quantity) ?? 0,
    entryPrice: round(finiteNumber(row.entry_price), 2),
    exitPrice: finiteNumber(row.exit_price) ?? 0,
    peakPrice: round(finiteNumber(row.peak_price), 2),
    postHigh: round(finiteNumber(row.post_high), 2),
    highVsExitPct: round(finiteNumber(row.high_vs_exit_pct), 1),
    missedToHigh: round(finiteNumber(row.missed_to_high) ?? 0, 2) ?? 0,
    holdMinutes: round(finiteNumber(row.hold_minutes), 1),
    score: round(finiteNumber(row.score), 1),
    mtfMatches: finiteNumber(row.mtf_matches),
    adx: round(finiteNumber(row.adx), 2),
    premiumAtRisk: round(finiteNumber(row.premium_at_risk), 2),
    finalAboveExit: row.final_above_exit === null ? null : Boolean(row.final_above_exit),
    recoveredEntry: row.recovered_entry === null ? null : Boolean(row.recovered_entry),
  }));
}

async function readSweepEvidence(config: Config): Promise<SweepEvidence[]> {
  let entries: string[];
  try {
    entries = await readdir(config.sweepRoot);
  } catch {
    return [];
  }

  const evidence: SweepEvidence[] = [];
  for (const entry of entries) {
    const resultPath = path.join(config.sweepRoot, entry, "results.json");
    try {
      const parsed = JSON.parse(await readFile(resultPath, "utf8")) as JsonRecord;
      const ranked = Array.isArray(parsed["ranked"])
        ? (parsed["ranked"] as JsonRecord[])
        : Array.isArray(parsed["results"])
          ? (parsed["results"] as JsonRecord[])
          : [];
      const best = ranked[0] ? asRecord(ranked[0]) : {};
      const metrics = asRecord(best["metrics"]);
      const variant = asRecord(best["variant"]);
      const window = asRecord(best["window"]);
      const start = typeof window["start"] === "string" ? window["start"] : null;
      const end = typeof window["end"] === "string" ? window["end"] : null;
      const winRate = finiteNumber(metrics["winRate"]);
      evidence.push({
        reportDir: path.join(config.sweepRoot, entry),
        window: start && end ? `${start} through ${end}` : null,
        bestVariant: typeof variant["id"] === "string" ? variant["id"] : null,
        bestPnl: round(finiteNumber(metrics["realizedPnl"]), 2),
        bestProfitFactor: round(finiteNumber(metrics["profitFactor"]), 3),
        bestTrades: finiteNumber(metrics["closedTrades"]),
        bestWinPct: winRate === null ? null : round(winRate * 100, 1),
        bestMaxDrawdown: round(finiteNumber(metrics["maxDrawdownAbs"]), 2),
      });
    } catch {
      // Ignore incomplete or unrelated report directories.
    }
  }
  return evidence
    .filter((item) => item.bestVariant && item.bestPnl !== null)
    .sort((left, right) => (right.bestPnl ?? 0) - (left.bestPnl ?? 0))
    .slice(0, 8);
}

export function buildRecommendations(input: {
  byExitReason: AggregateRow[];
  weakSymbols: SymbolRow[];
  sweepEvidence: SweepEvidence[];
  opportunityRatio: number | null;
}): Recommendation[] {
  const byReason = new Map(input.byExitReason.map((row) => [row.bucket, row]));
  const runner = byReason.get("runner_trail_stop");
  const opposite = byReason.get("opposite_signal");
  const early = byReason.get("early_invalidation");
  const overnight = byReason.get("overnight_risk_exit");
  const bestSweep = input.sweepEvidence[0];
  const recommendations: Recommendation[] = [];

  if (runner && runner.missedToPostExitHigh > Math.max(runner.pnl * 2, 25_000)) {
    recommendations.push({
      lane: "exit_management",
      priority: "high",
      title: "Keep a runner alive after first trail exit",
      evidence: `${runner.exits} runner-trail exits produced ${runner.pnl.toFixed(2)} realized P&L but left ${runner.missedToPostExitHigh.toFixed(2)} to post-exit highs.`,
      nextTest:
        "Dry-run partial exits: sell 50-70% at current trail, keep 30-50% under a looser trend/ATR trail, and compare April train vs May holdout.",
    });
  }

  if (opposite && opposite.missedToPostExitHigh > 50_000) {
    recommendations.push({
      lane: "exit_management",
      priority: "high",
      title: "Require confirmation before full opposite-signal liquidation",
      evidence: `${opposite.exits} opposite-signal exits left ${opposite.missedToPostExitHigh.toFixed(2)} to later highs while still making ${opposite.pnl.toFixed(2)}.`,
      nextTest:
        "Test half-exit on first opposite signal, full exit only after second confirming bar or MTF direction loss.",
    });
  }

  if (early && early.finalAboveExit > early.exits * 0.35) {
    recommendations.push({
      lane: "entry_filtering",
      priority: "medium",
      title: "Convert early invalidation from permanent exit to re-entry watch",
      evidence: `${early.finalAboveExit}/${early.exits} early invalidations finished above their exit price despite negative realized P&L.`,
      nextTest:
        "Test a re-entry rule after early invalidation when the original direction re-confirms within 3-6 bars and option liquidity is still valid.",
    });
  }

  if (overnight && overnight.missedToPostExitHigh > 50_000) {
    recommendations.push({
      lane: "portfolio",
      priority: "medium",
      title: "Differentiate overnight exits for strong runners",
      evidence: `Overnight-risk exits were nearly flat on realized P&L (${overnight.pnl.toFixed(2)}) but left ${overnight.missedToPostExitHigh.toFixed(2)} to post-exit highs.`,
      nextTest:
        "Allow high-quality runners to hold a small residual overnight with a wider runner stop while forcing weak/flat positions out.",
    });
  }

  const weak = input.weakSymbols.slice(0, 5).filter((row) => row.pnl < 500);
  if (weak.length) {
    recommendations.push({
      lane: "entry_filtering",
      priority: "medium",
      title: "Downweight or exclude weak expectancy symbols",
      evidence: `Lowest buckets include ${weak.map((row) => `${row.symbol} ${row.pnl.toFixed(2)}`).join(", ")}.`,
      nextTest:
        "Run a symbol-exclusion holdout sweep; only remove symbols that improve both April and May or improve one without harming the other materially.",
    });
  }

  if (bestSweep?.bestVariant) {
    recommendations.push({
      lane: "exit_management",
      priority: "medium",
      title: "Promote prior dry-sweep winners into the next hypothesis set",
      evidence: `Best prior sweep evidence is ${bestSweep.bestVariant} with ${bestSweep.bestPnl?.toFixed(2)} P&L, ${bestSweep.bestProfitFactor} PF, and ${bestSweep.bestTrades} trades.`,
      nextTest:
        "Use that variant as the baseline for new partial-runner, re-entry, and sizing counterfactuals.",
    });
  }

  if (input.opportunityRatio !== null && input.opportunityRatio > 3) {
    recommendations.push({
      lane: "sizing",
      priority: "low",
      title: "Scale only after management improves capture",
      evidence: `The post-exit opportunity ratio is ${input.opportunityRatio.toFixed(2)}x, so raw sizing alone risks amplifying avoidable exits.`,
      nextTest:
        "After exit/re-entry improvements, test quality-based premium caps and add-ons only for trades that reach +50%/+100%.",
    });
  }

  recommendations.push({
    lane: "data_quality",
    priority: "low",
    title: "Keep audit-quality fill provenance in the loop",
    evidence:
      "The April external audit found exact trade-source matches but aggregate-sourced sell exits had unresolved strict mismatches.",
    nextTest:
      "For candidate production settings, rerun the Polygon-compatible audit and separate trade-sourced vs aggregate-sourced exit conclusions.",
  });

  return recommendations;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function topLeaksCsv(rows: LeakRow[]): string {
  const columns: (keyof LeakRow)[] = [
    "symbol",
    "reason",
    "closedAt",
    "pnl",
    "quantity",
    "entryPrice",
    "exitPrice",
    "peakPrice",
    "postHigh",
    "highVsExitPct",
    "missedToHigh",
    "holdMinutes",
    "score",
    "mtfMatches",
    "adx",
    "premiumAtRisk",
    "finalAboveExit",
    "recoveredEntry",
  ];
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
  ].join("\n");
}

function markdownTable<T extends Record<string, unknown>>(
  rows: T[],
  columns: { key: keyof T; label: string }[],
): string {
  if (!rows.length) return "No rows.";
  return [
    `| ${columns.map((column) => column.label).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map(
      (row) => `| ${columns.map((column) => csvCell(row[column.key])).join(" | ")} |`,
    ),
  ].join("\n");
}

function buildMarkdown(output: ReviewOutput): string {
  const opportunity = output.summary.opportunity;
  return [
    "# Shadow Options Management Review",
    "",
    `- Generated: ${output.summary.generatedAt}`,
    `- Account: ${output.summary.accountId}`,
    `- Window: ${output.summary.window.start} through ${output.summary.window.end}`,
    `- Report directory: ${output.summary.reportDir}`,
    "",
    "## Ledger Summary",
    "",
    `- Fills: ${output.summary.ledger.fills}`,
    `- Buy fills: ${output.summary.ledger.buyFills}`,
    `- Sell fills: ${output.summary.ledger.sellFills}`,
    `- Symbols: ${output.summary.ledger.symbols}`,
    `- Fill window: ${output.summary.ledger.firstFillAt} to ${output.summary.ledger.lastFillAt}`,
    `- Realized P&L: ${output.summary.ledger.realizedPnl.toFixed(2)}`,
    `- Fees: ${output.summary.ledger.fees.toFixed(2)}`,
    `- Cash delta: ${output.summary.ledger.cashDelta.toFixed(2)}`,
    "",
    "## Opportunity Snapshot",
    "",
    `- Realized exit P&L: ${opportunity.realizedExitPnl.toFixed(2)}`,
    `- Post-exit high opportunity: ${opportunity.missedToPostExitHigh.toFixed(2)}`,
    `- Opportunity / realized ratio: ${opportunity.missedToRealizedRatio?.toFixed(2) ?? "n/a"}x`,
    `- Caveat: ${opportunity.caveat}`,
    "",
    "## Recommendations",
    "",
    ...output.recommendations.map(
      (item) =>
        `- **${item.priority.toUpperCase()} ${item.lane}: ${item.title}** ${item.evidence} Next test: ${item.nextTest}`,
    ),
    "",
    "## Exit Reasons",
    "",
    markdownTable(output.byExitReason, [
      { key: "bucket", label: "Reason" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
      { key: "reached25AfterExit", label: "Reached +25% After Exit" },
      { key: "finalAboveExit", label: "Final > Exit" },
    ]),
    "",
    "## Top Symbols",
    "",
    markdownTable(output.topSymbols.slice(0, 15), [
      { key: "symbol", label: "Symbol" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
    ]),
    "",
    "## Weak Symbols",
    "",
    markdownTable(output.weakSymbols.slice(0, 15), [
      { key: "symbol", label: "Symbol" },
      { key: "exits", label: "Exits" },
      { key: "wins", label: "Wins" },
      { key: "winPct", label: "Win %" },
      { key: "pnl", label: "P&L" },
      { key: "avgPnl", label: "Avg P&L" },
      { key: "missedToPostExitHigh", label: "Missed To High" },
    ]),
    "",
    "## Prior Sweep Evidence",
    "",
    markdownTable(output.sweepEvidence, [
      { key: "bestVariant", label: "Best Variant" },
      { key: "bestPnl", label: "P&L" },
      { key: "bestProfitFactor", label: "PF" },
      { key: "bestTrades", label: "Trades" },
      { key: "bestWinPct", label: "Win %" },
      { key: "bestMaxDrawdown", label: "Max DD" },
      { key: "window", label: "Window" },
      { key: "reportDir", label: "Report Dir" },
    ]),
    "",
    "## Largest Post-Exit Leaks",
    "",
    markdownTable(output.topLeaks.slice(0, 20), [
      { key: "symbol", label: "Symbol" },
      { key: "reason", label: "Reason" },
      { key: "closedAt", label: "Closed At" },
      { key: "pnl", label: "P&L" },
      { key: "exitPrice", label: "Exit" },
      { key: "postHigh", label: "Post High" },
      { key: "highVsExitPct", label: "High vs Exit %" },
      { key: "missedToHigh", label: "Missed $" },
      { key: "score", label: "Score" },
    ]),
    "",
    "Full row-level leak details are in `top-leaks.csv`; structured output is in `results.json`.",
    "",
  ].join("\n");
}

async function buildReview(config: Config): Promise<ReviewOutput> {
  const [ledger, byMonth, byExitReason, byQuality, topSymbols, weakSymbols, topLeaks, sweepEvidence] =
    await Promise.all([
      loadLedgerSummary(config),
      loadAggregate(config, "to_char(date_trunc('month', f.occurred_at), 'YYYY-MM')"),
      loadAggregate(config, "coalesce(o.payload->>'reason', 'unknown')"),
      loadAggregate(
        config,
        "coalesce(o.payload #>> '{position,signalQuality,tier}', 'unknown') || ':' || coalesce(width_bucket((o.payload #>> '{position,signalQuality,score}')::numeric, 0, 100, 5)::text, 'unknown')",
      ),
      loadSymbols(config, "best"),
      loadSymbols(config, "worst"),
      loadTopLeaks(config),
      readSweepEvidence(config),
    ]);

  const realizedExitPnl = byExitReason.reduce((sum, row) => sum + row.pnl, 0);
  const missedToPostExitHigh = byExitReason.reduce(
    (sum, row) => sum + row.missedToPostExitHigh,
    0,
  );
  const missedToRealizedRatio =
    realizedExitPnl > 0 ? round(missedToPostExitHigh / realizedExitPnl, 2) : null;
  const recommendations = buildRecommendations({
    byExitReason,
    weakSymbols,
    sweepEvidence,
    opportunityRatio: missedToRealizedRatio,
  });

  return {
    summary: {
      generatedAt: new Date().toISOString(),
      accountId: config.accountId,
      window: { start: config.start, end: config.end },
      reportDir: config.reportDir,
      ledger,
      opportunity: {
        realizedExitPnl: round(realizedExitPnl, 2) ?? 0,
        missedToPostExitHigh: round(missedToPostExitHigh, 2) ?? 0,
        missedToRealizedRatio,
        caveat:
          "Post-exit highs are an upper-bound diagnostic, not capturable P&L; use them to rank management hypotheses before dry-run validation.",
      },
    },
    byMonth,
    byExitReason,
    byQuality,
    topSymbols,
    weakSymbols,
    topLeaks,
    sweepEvidence,
    recommendations,
  };
}

async function writeReview(output: ReviewOutput): Promise<void> {
  await mkdir(output.summary.reportDir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(output.summary.reportDir, "results.json"),
      `${JSON.stringify(output, null, 2)}\n`,
    ),
    writeFile(path.join(output.summary.reportDir, "top-leaks.csv"), `${topLeaksCsv(output.topLeaks)}\n`),
    writeFile(path.join(output.summary.reportDir, "report.md"), `${buildMarkdown(output)}\n`),
  ]);
}

async function main(): Promise<void> {
  const config = readConfig();
  const output = await buildReview(config);
  await writeReview(output);
  console.log(
    JSON.stringify(
      {
        reportDir: output.summary.reportDir,
        window: output.summary.window,
        fills: output.summary.ledger.fills,
        realizedExitPnl: output.summary.opportunity.realizedExitPnl,
        missedToPostExitHigh: output.summary.opportunity.missedToPostExitHigh,
        missedToRealizedRatio: output.summary.opportunity.missedToRealizedRatio,
        recommendations: output.recommendations.length,
      },
      null,
      2,
    ),
  );
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
