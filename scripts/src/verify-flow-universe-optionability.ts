import { db } from "@workspace/db";
import {
  classifyFlowUniverseOptionabilityProbeResult,
  loadFlowUniverseOptionabilityCandidates,
  markFlowUniverseOptionability,
} from "../../artifacts/api-server/src/services/flow-universe-optionability-verifier";
import { getOptionExpirationsWithDebug } from "../../artifacts/api-server/src/services/platform";
import {
  loadWatchlistUniversePrioritySymbols,
  parseUniversePrioritySymbolList,
  uniqueUniversePrioritySymbols,
} from "./universe-priority";

function parseArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function parseBooleanArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  return raw !== "false";
}

function parsePositiveIntegerArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const limit = parsePositiveIntegerArg("limit", 100);
  const delayMs = parsePositiveIntegerArg("delay-ms", 750);
  const force = parseBooleanArg("force", false);
  const dryRun = parseBooleanArg("dry-run", false);
  const explicitSymbols = parseUniversePrioritySymbolList(parseArg("symbols"));
  const includeWatchlists = parseBooleanArg("watchlists", true);
  const watchlistSymbols = includeWatchlists
    ? await loadWatchlistUniversePrioritySymbols()
    : [];
  const prioritySymbols = uniqueUniversePrioritySymbols([
    ...explicitSymbols,
    ...watchlistSymbols,
  ]);

  const rows = await loadFlowUniverseOptionabilityCandidates({
    db,
    limit,
    markets: ["stocks", "etf"],
    prioritySymbols,
    force,
  });

  const results: Array<{
    symbol: string;
    status: "verified" | "rejected" | "error";
    reason: string | null;
  }> = [];

  for (const row of rows) {
    try {
      const expirations = await getOptionExpirationsWithDebug({
        underlying: row.symbol,
        maxExpirations: 1,
        recordBridgeFailure: false,
      });
      const classification =
        classifyFlowUniverseOptionabilityProbeResult(expirations);
      if (classification.status !== "error" && !dryRun) {
        await markFlowUniverseOptionability({
          db,
          symbol: row.symbol,
          market: row.market,
          listingKey: row.listingKey,
          status: classification.status,
          reason: classification.reason,
          verifiedAt: new Date(),
          source: "option_expirations_probe",
        });
      }
      results.push({
        symbol: row.symbol,
        status: classification.status,
        reason: classification.reason,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({ symbol: row.symbol, status: "error", reason });
    }
    if (delayMs > 0) {
      await wait(delayMs);
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        force,
        explicitSymbolCount: explicitSymbols.length,
        watchlistSymbolCount: watchlistSymbols.length,
        prioritySymbolCount: prioritySymbols.length,
        requestedLimit: limit,
        attempted: results.length,
        verified: results.filter((result) => result.status === "verified")
          .length,
        rejected: results.filter((result) => result.status === "rejected")
          .length,
        errors: results.filter((result) => result.status === "error").length,
        sample: results.slice(0, 20),
      },
      null,
      2,
    ),
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
