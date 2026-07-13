import { pathToFileURL } from "node:url";
import { parseArgs, stripVTControlCharacters } from "node:util";
import {
  pool,
  resolveSnapshotRetentionConfig,
  runAllSnapshotRetention,
  type RetentionResult,
  type SnapshotRetentionConfig,
} from "@workspace/db";

// CLI for DB maintenance roadmap Phase 2 Task 7. The shared runner is the only
// retention-owner registry; this boundary stays dry-run by default and reports
// partial/error results without adding a second pressure-heavy verification pass.
//
//   pnpm db:snapshot-retention:audit
//   pnpm db:snapshot-retention            # dry-run
//   pnpm db:snapshot-retention -- --execute

type RetentionCommand = "audit" | "retention";
type RetentionArgs = { command: RetentionCommand; execute: boolean };
type RetentionRunner = (opts?: {
  config?: SnapshotRetentionConfig;
  now?: Date;
  dryRun?: boolean;
}) => Promise<RetentionResult[]>;

const USAGE =
  "Usage: pnpm db:snapshot-retention:audit | pnpm db:snapshot-retention [-- --execute]";
const MAX_DIAGNOSTIC_LENGTH = 400;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu;

function parseRetentionArgs(args = process.argv.slice(2)): RetentionArgs {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  try {
    const parsed = parseArgs({
      args: normalizedArgs,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: { execute: { type: "boolean" } },
    });
    const command = parsed.positionals[0] ?? "audit";
    const executeCount = parsed.tokens.filter(
      (token) => token.kind === "option" && token.name === "execute",
    ).length;
    const execute = parsed.values.execute ?? false;
    if (
      parsed.positionals.length > 1 ||
      (command !== "audit" && command !== "retention") ||
      executeCount > 1 ||
      (execute && command !== "retention")
    ) {
      throw new Error(USAGE);
    }
    return { command, execute };
  } catch {
    throw new Error(USAGE);
  }
}

function safeDiagnostic(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const withoutCredentials = (raw || "Unknown database error")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^@\s]+@/giu, "$1[redacted]@")
    .replace(/\s+/gu, " ");
  const cleaned = stripVTControlCharacters(withoutCredentials)
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const diagnostic = cleaned || "Unknown database error";
  if (diagnostic.length <= MAX_DIAGNOSTIC_LENGTH) return diagnostic;
  return `${diagnostic.slice(0, MAX_DIAGNOSTIC_LENGTH - 1)}…`;
}

async function runRetention(
  args: RetentionArgs,
  config: SnapshotRetentionConfig,
  runner: RetentionRunner = runAllSnapshotRetention,
): Promise<RetentionResult[]> {
  return runner({ config, dryRun: !args.execute });
}

function incompleteResults(
  results: RetentionResult[],
  execute: boolean,
): RetentionResult[] {
  return results.filter(
    (result) => Boolean(result.error) || (execute && result.hitCap),
  );
}

async function main(): Promise<void> {
  const args = parseRetentionArgs();
  const config = resolveSnapshotRetentionConfig();
  console.log(`command=${args.command}`);
  console.log(`batch_size=${config.batchSize}`);
  console.log(`dry_run=${!args.execute}`);

  const results = await runRetention(args, config);
  console.table(
    results.map((result) => ({
      table: result.table,
      cutoff: result.cutoff,
      candidates: result.candidates,
      deleted: result.deleted,
      hitCap: result.hitCap,
      durationMs: result.durationMs,
      dryRun: result.dryRun,
      error: result.error ? safeDiagnostic(result.error) : "-",
    })),
  );

  const incomplete = incompleteResults(results, args.execute);
  if (!args.execute) {
    console.log("Pass --execute to delete eligible rows.");
  }
  console.log(
    `${args.execute ? "retention_complete" : "retention_check_complete"}=${incomplete.length === 0}`,
  );
  if (incomplete.length > 0) process.exitCode = 1;
}

export const __dbSnapshotRetentionInternalsForTests = {
  MAX_DIAGNOSTIC_LENGTH,
  incompleteResults,
  parseRetentionArgs,
  runRetention,
  safeDiagnostic,
};

async function runCli(): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(safeDiagnostic(error));
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch (error) {
      console.error(`Failed to close database pool: ${safeDiagnostic(error)}`);
      process.exitCode = 1;
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runCli();
}
