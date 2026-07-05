// Bounded, read-only audit: does the STA score predict outcomes for BUY and SELL
// signals separately? Mirrors the production KPI pipeline (same bar_cache source,
// same settings resolution, same evaluatePyrusSignalsSignals + forward-return
// windows, all-signal population, direction-adjusted returns) over a
// deterministic sample of the deployment universe, then slices observations by
// direction x score bucket and computes a rank AUC per direction.
import { algoDeploymentsTable, db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  evaluatePyrusSignalsSignals,
  resolvePyrusSignalsSignalSettings,
  type PyrusSignalsBar,
} from "@workspace/pyrus-signals-core";
import { buildSignalForwardReturnDataset } from "@workspace/backtest-core";
import {
  computeSignalQualityKpis,
  __signalQualityKpisInternalsForTests,
} from "./src/services/signal-quality-kpis";
import { __signalQualityKpisServiceInternalsForTests } from "./src/services/signal-quality-kpis-service";

const { scoreFromSignalFilterState } = __signalQualityKpisInternalsForTests;
const { resolveDeploymentSignalSettings, resolveMtfConfig, previewTimeframeFor } =
  __signalQualityKpisServiceInternalsForTests;

const SAMPLE_SIZE = 60;
const WINDOW_DAYS = 90;
const MAX_BARS = 720;
const BAR_CACHE_SOURCE = "massive-history";

async function main() {
  const deployments = await db.select().from(algoDeploymentsTable);
  const deployment =
    deployments.find((d: any) => d.enabled === true) ?? deployments[0];
  if (!deployment) throw new Error("no algo deployment found");
  console.log(
    `deployment: id=${deployment.id} mode=${deployment.mode} strategy=${deployment.strategyId}`,
  );

  const profileResp = await fetch(
    "http://127.0.0.1:8080/api/signal-monitor/profile",
  );
  const profileJson = (await profileResp.json()) as any;
  const profile = profileJson.profile ?? profileJson;

  const settings = resolveDeploymentSignalSettings({
    deploymentConfig: deployment.config,
    profilePyrusSignalsSettings: profile.pyrusSignalsSettings,
    profileTimeframe: profile.timeframe,
    draft: undefined,
  });
  const mtf = resolveMtfConfig(deployment.config);
  const timeframe = previewTimeframeFor(settings.signalTimeframe);
  const horizonBars = Math.max(1, Math.round(settings.outcomeHorizonBars));
  console.log(
    `signalTimeframe=${settings.signalTimeframe} previewTimeframe=${timeframe} horizonBars=${horizonBars} (timeHorizon=${settings.timeHorizon})`,
  );

  const universe: string[] = Array.from(
    new Set(
      ((deployment.symbolUniverse ?? []) as string[]).map((s) =>
        String(s).toUpperCase(),
      ),
    ),
  ).sort();
  const step = Math.max(1, Math.floor(universe.length / SAMPLE_SIZE));
  const symbols = universe.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);
  console.log(`universe=${universe.length} sampled=${symbols.length} (every ${step}th)`);

  const from = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  // The live bar_cache is hot/contended (statement timeouts on fine-timeframe
  // desc scans) — mirror the service's coarser-timeframe fallback chain and
  // tolerate per-chunk failures.
  const fallbackChain = [timeframe, "15m", "30m", "1h"].filter(
    (tf, i, all) => all.indexOf(tf) === i,
  );
  let barsBySymbol: Record<string, PyrusSignalsBar[]> = {};
  let resolvedTimeframe = timeframe;
  let timedOutChunks = 0;
  for (const tf of fallbackChain) {
    barsBySymbol = {};
    timedOutChunks = 0;
    for (let i = 0; i < symbols.length; i += 5) {
      const chunk = symbols.slice(i, i + 5);
      const symbolValues = sql.join(chunk.map((s) => sql`${s}`), sql`, `);
      try {
        const result = await db.execute(sql`
          select b.symbol, b.starts_at, b.open, b.high, b.low, b.close, b.volume
          from unnest(array[${symbolValues}]::text[]) as s(symbol)
          cross join lateral (
            select symbol, starts_at, open, high, low, close, volume
            from bar_cache
            where symbol = s.symbol
              and timeframe = ${tf}
              and source = ${BAR_CACHE_SOURCE}
              and starts_at >= ${from}
            order by starts_at desc
            limit ${MAX_BARS}
          ) b
        `);
        for (const row of (result as any).rows ?? result) {
          const symbol = String(row.symbol);
          (barsBySymbol[symbol] ??= []).push({
            time: Math.floor(new Date(row.starts_at).getTime() / 1000),
            o: Number(row.open),
            h: Number(row.high),
            l: Number(row.low),
            c: Number(row.close),
            v: Number(row.volume ?? 0),
          });
        }
      } catch {
        timedOutChunks += 1;
      }
    }
    resolvedTimeframe = tf;
    const withBars = Object.keys(barsBySymbol).length;
    console.log(
      `timeframe=${tf}: symbolsWithBars=${withBars}/${symbols.length} timedOutChunks=${timedOutChunks}`,
    );
    if (withBars >= Math.min(20, symbols.length) && timedOutChunks === 0) break;
    if (withBars >= symbols.length * 0.8) break;
  }
  let symbolsWithBars = 0;
  for (const symbol of Object.keys(barsBySymbol)) {
    barsBySymbol[symbol].sort((a, b) => a.time - b.time);
    symbolsWithBars += 1;
  }
  console.log(`resolvedTimeframe=${resolvedTimeframe} symbols with bars: ${symbolsWithBars}`);

  const pyrusSettings = resolvePyrusSignalsSignalSettings({
    timeHorizon: settings.timeHorizon,
    bosConfirmation: settings.bosConfirmation,
    chochAtrBuffer: settings.chochAtrBuffer,
    chochBodyExpansionAtr: settings.chochBodyExpansionAtr,
    chochVolumeGate: settings.chochVolumeGate,
  });

  // Official engine result over the sample (cross-check + calibration verdict).
  const official = computeSignalQualityKpis({
    settings: pyrusSettings,
    barsBySymbol,
    horizonBars,
    mtf,
    sourceStrategy: deployment.strategyId,
    sourceProfile: deployment.mode,
    sourceTimeframe: timeframe,
  });

  // Mirror of the engine's observation collection, kept per-direction.
  type Obs = { direction: "long" | "short"; score: number | null; ret: number };
  const observations: Obs[] = [];
  for (const [symbol, bars] of Object.entries(barsBySymbol)) {
    if (!bars.length) continue;
    const evaluation = evaluatePyrusSignalsSignals({
      chartBars: bars,
      settings: pyrusSettings,
      includeProvisionalSignals: false,
    });
    if (!evaluation.signalEvents.length) continue;
    const signals = evaluation.signalEvents.map((event: any) => ({
      signalId: event.id,
      signalAt: new Date(event.time * 1000),
      symbol,
      direction: event.direction,
      score: scoreFromSignalFilterState({
        filterState: event.filterState,
        direction: event.direction,
      }),
      sourceStrategy: "audit",
      sourceProfile: "audit",
      sourceTimeframe: timeframe,
    }));
    const dataset = buildSignalForwardReturnDataset({
      signals,
      barsBySymbol: {
        [symbol]: bars.map((bar) => ({
          startsAt: new Date(bar.time * 1000),
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        })),
      },
      horizonsBars: [horizonBars],
    });
    for (const row of dataset.rows) {
      const window = row.windows.find((w: any) => w.horizonBars === horizonBars);
      if (!window || window.status !== "complete" || window.realizedReturnPercent == null) {
        continue;
      }
      observations.push({
        direction: row.direction,
        score: row.score,
        ret: window.realizedReturnPercent,
      });
    }
  }

  const BUCKETS: Array<[number, number, string]> = [
    [20, 40, "20-40"],
    [40, 50, "40-50"],
    [50, 60, "50-60"],
    [60, 70, "60-70"],
  ];
  function bucketOf(score: number): string {
    for (const [lo, hi, label] of BUCKETS) if (score >= lo && score < hi) return label;
    return score >= 70 ? "70+" : "<20";
  }
  function auc(rows: Obs[]): number | null {
    const wins = rows.filter((r) => r.ret > 0 && r.score != null);
    const losses = rows.filter((r) => r.ret <= 0 && r.score != null);
    if (!wins.length || !losses.length) return null;
    let favorable = 0;
    for (const w of wins)
      for (const l of losses)
        favorable += w.score! > l.score! ? 1 : w.score! === l.score! ? 0.5 : 0;
    return favorable / (wins.length * losses.length);
  }
  function describe(rows: Obs[]): Record<string, unknown> {
    const scored = rows.filter((r) => r.score != null);
    const byBucket: Record<string, { n: number; hit: number; sum: number }> = {};
    for (const r of scored) {
      const b = (byBucket[bucketOf(r.score!)] ??= { n: 0, hit: 0, sum: 0 });
      b.n += 1;
      if (r.ret > 0) b.hit += 1;
      b.sum += r.ret;
    }
    const buckets: Record<string, string> = {};
    for (const [, , label] of BUCKETS) {
      const b = byBucket[label];
      buckets[label] = b
        ? `n=${b.n} hit=${((100 * b.hit) / b.n).toFixed(1)}% avgRet=${(b.sum / b.n).toFixed(3)}%`
        : "n=0";
    }
    for (const label of ["<20", "70+"]) {
      if (byBucket[label]) {
        const b = byBucket[label];
        buckets[label] = `n=${b.n} hit=${((100 * b.hit) / b.n).toFixed(1)}% avgRet=${(b.sum / b.n).toFixed(3)}%`;
      }
    }
    return {
      n: rows.length,
      scored: scored.length,
      hitRate: `${((100 * rows.filter((r) => r.ret > 0).length) / Math.max(1, rows.length)).toFixed(1)}%`,
      avgRet: `${(rows.reduce((s, r) => s + r.ret, 0) / Math.max(1, rows.length)).toFixed(3)}%`,
      auc: auc(rows)?.toFixed(3) ?? "n/a",
      buckets,
    };
  }

  const longs = observations.filter((o) => o.direction === "long");
  const shorts = observations.filter((o) => o.direction === "short");
  console.log("\n=== AUDIT: score -> outcome by direction ===");
  console.log(`observations total=${observations.length}`);
  console.log("BUY (long):", JSON.stringify(describe(longs), null, 2));
  console.log("SELL (short):", JSON.stringify(describe(shorts), null, 2));
  console.log("ALL:", JSON.stringify(describe(observations), null, 2));

  console.log("\n=== Official engine cross-check (same sample) ===");
  console.log(
    JSON.stringify(
      {
        signalCount: official.signalCount,
        correctnessPercent: official.correctnessPercent,
        expectancyPercent: official.expectancyPercent,
        byDirection: official.byDirection,
        byScoreRange: official.byScoreRange,
        calibration: official.scoreModelComparisons?.calibration,
        recommendedModelKey: (official.scoreModelComparisons as any)?.recommendedModelKey,
        activeModelKey: (official.scoreModelComparisons as any)?.activeModelKey,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("AUDIT FAILED:", error);
  process.exit(1);
});
