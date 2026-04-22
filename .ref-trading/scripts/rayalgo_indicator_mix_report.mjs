#!/usr/bin/env node

import fs from "fs";
import path from "path";

function formatSigned(value, precision = 3) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "n/a";
  }
  const rounded = numeric.toFixed(precision).replace(/\.?0+$/, "");
  return numeric > 0 ? `+${rounded}` : rounded;
}

function parseArgs(argv) {
  const [file = ""] = argv.slice(2);
  return { file };
}

function scoreRecommendation(feature) {
  const key = String(feature?.featureKey || "").trim();
  const state = String(feature?.state || "").trim();
  const lift = Number(feature?.realizedQualityLift);
  const guidance = Number(feature?.guidanceRatePct);
  if (!key || !Number.isFinite(lift)) {
    return null;
  }
  const direction = lift > 0 ? "keep/emphasize" : "de-emphasize/penalize";
  return `${direction} ${key}${state ? `=${state}` : ""} (${formatSigned(lift)} rq, ${Number.isFinite(guidance) ? `${guidance.toFixed(1)}%` : "n/a"} guidance)`;
}

function printFeatureBlock(label, items = []) {
  console.log(label);
  for (const item of items) {
    const recommendation = scoreRecommendation(item);
    if (recommendation) {
      console.log(`- ${recommendation}`);
    }
  }
}

function main() {
  const { file } = parseArgs(process.argv);
  if (!file) {
    throw new Error("Usage: node scripts/rayalgo_indicator_mix_report.mjs <score-study.json>");
  }
  const resolvedPath = path.resolve(process.cwd(), file);
  const payload = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  console.log(`Artifact: ${resolvedPath}`);
  console.log(`Symbol: ${String(payload?.symbol || "SPY").toUpperCase()} | mode=${payload?.mode || "unknown"} | generated=${payload?.generatedAt || "unknown"}`);

  for (const timeframe of ["1m", "2m"]) {
    const row = payload?.result?.timeframeDetails?.[timeframe] || null;
    if (!row) {
      continue;
    }
    const summary = row?.signalClassSummaries?.trend_change?.directions?.combined || {};
    const followThrough = row?.directions?.combined?.overallSummary?.headlineBlocks?.follow_through || null;
    const positives = summary?.featureImpactSummaries?.topPositiveStates || [];
    const negatives = summary?.featureImpactSummaries?.topNegativeStates || [];
    console.log("");
    console.log(`[${timeframe}] preferred=${row.preferredScoreType || "n/a"} signals=${row.signalCount || 0}`);
    if (followThrough) {
      console.log(`follow-through: guidance=${followThrough.guidanceRatePct}% excursion=${followThrough.meanExcursionEdgeAtr}ATR close=${followThrough.meanCloseReturnAtr}ATR`);
    }
    printFeatureBlock("positives", positives.slice(0, 6));
    printFeatureBlock("negatives", negatives.slice(0, 6));
  }
}

main();
