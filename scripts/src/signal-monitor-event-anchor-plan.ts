import { pathToFileURL } from "node:url";
import { pool } from "@workspace/db";
import { buildSignalMonitorEventAnchorBackfillPlan } from "../../artifacts/api-server/src/services/signal-monitor";

type RuntimeMode = "shadow" | "live";

type Config = {
  environment: RuntimeMode;
  candidateLimit: number;
  json: boolean;
  write: boolean;
  confirmWrite: boolean;
};

function argValue(name: string): string | null {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function hasArg(name: string): boolean {
  return process.argv.includes(name);
}

function usage(): string {
  return [
    "Usage:",
    "  pnpm --filter @workspace/scripts run signal-monitor:event-anchor-plan -- [--environment=shadow] [--candidate-limit=50] [--json] [--write --confirm-write]",
    "",
    "Dry-run is the default. Write mode requires both --write and --confirm-write.",
  ].join("\n");
}

function parseEnvironment(): RuntimeMode {
  const environment = (argValue("--environment") || "shadow").trim();
  if (environment !== "shadow" && environment !== "live") {
    throw new Error("Use --environment=shadow or --environment=live.");
  }
  return environment;
}

function parseNonNegativeInteger(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid non-negative integer: ${raw}`);
  }
  return Math.floor(value);
}

function readConfig(): Config {
  if (hasArg("--help") || hasArg("-h")) {
    console.log(usage());
    process.exit(0);
  }
  return {
    environment: parseEnvironment(),
    candidateLimit: parseNonNegativeInteger(argValue("--candidate-limit"), 50),
    json: hasArg("--json"),
    write: hasArg("--write"),
    confirmWrite: hasArg("--confirm-write"),
  };
}

function formatError(error: unknown): string {
  const lines = [error instanceof Error ? error.message : String(error)];
  const cause =
    error && typeof error === "object" && "cause" in error
      ? (error as { cause?: unknown }).cause
      : null;
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    const message = record["message"];
    if (message) lines.push(`Cause: ${String(message)}`);
    for (const key of ["code", "detail", "hint", "position"]) {
      if (record[key]) lines.push(`${key}: ${String(record[key])}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  const config = readConfig();
  if (config.write && !config.confirmWrite) {
    throw new Error("Write mode requires --confirm-write.");
  }
  const plan = await buildSignalMonitorEventAnchorBackfillPlan({
    environment: config.environment,
    candidateLimit: config.candidateLimit,
    apply: config.write,
  });

  if (config.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log("Signal Monitor event-anchor backfill plan");
  console.log(`Environment: ${plan.environment}`);
  console.log(`Generated at: ${plan.generatedAt}`);
  console.log(`Dry run: ${plan.dryRun ? "true" : "false"}`);
  console.log(`Active cells needing anchor: ${plan.counts.activeCellsNeedingAnchor}`);
  console.log(`Candidate events: ${plan.counts.candidateEvents}`);
  console.log(`Skipped, missing signal_at: ${plan.counts.skippedNoSignalAt}`);
  console.log(`Attempted inserts: ${plan.applied.attemptedEvents}`);
  console.log(`Inserted anchor events: ${plan.applied.insertedEvents}`);
  console.log(`Skipped existing events: ${plan.applied.skippedExistingEvents}`);
  console.log(`Sampled candidates: ${plan.counts.sampledCandidates}`);
  console.log(`Sampled skipped: ${plan.counts.sampledSkipped}`);
  if (plan.candidates.length) {
    console.log("Sample candidates:");
    for (const candidate of plan.candidates) {
      console.log(
        `- ${candidate.symbol} ${candidate.timeframe} ${candidate.reason}: ${candidate.direction} @ ${candidate.signalAt} close=${candidate.close}`,
      );
    }
  }
  if (plan.skipped.length) {
    console.log("Sample skipped:");
    for (const skipped of plan.skipped) {
      console.log(
        `- ${skipped.symbol} ${skipped.timeframe} ${skipped.reason}: ${skipped.direction}`,
      );
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((error) => {
      console.error(formatError(error));
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
    });
}
