import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

type ScribeDocumentRow = {
  id: string;
  state: string | Buffer;
  lastChangedClock: number;
};

export type ScribeArtifactRecord = {
  id: string;
  artifactId: string;
  ownerId: string | null;
  componentName: string | null;
  state: string | null;
  artifactKind: string | null;
  x: number | null;
  y: number | null;
  w: number | null;
  h: number | null;
  lastChangedClock: number;
};

export type ScribeArtifactCleanupSelection = {
  keepPrimaryId: string | null;
  cleanup: Array<ScribeArtifactRecord & { reason: string }>;
};

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const DEFAULT_DB_PATH = path.join(repoRoot, ".local/state/scribe/scribe.db");
const DEFAULT_PRIMARY_ARTIFACT_ID = "artifacts/pyrus";
export const CONTROL_PLANE_CLEANUP_ENV =
  "PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP";
const CONTROL_PLANE_CLEANUP_CONFIRM_FLAG = "--confirm-control-plane-cleanup";

const parseState = (state: string | Buffer) => {
  const text = Buffer.isBuffer(state) ? state.toString("utf8") : state;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function parseScribeArtifactDocuments(
  rows: ScribeDocumentRow[],
): ScribeArtifactRecord[] {
  return rows
    .map((row) => {
      const state = parseState(row.state);
      const props =
        state && "props" in state && state.props && typeof state.props === "object"
          ? (state.props as Record<string, unknown>)
          : {};
      const artifactId =
        typeof props.artifactId === "string" ? props.artifactId : null;
      if (!artifactId || state?.type !== "iframe") {
        return null;
      }

      return {
        id: row.id,
        artifactId,
        ownerId: typeof props.ownerId === "string" ? props.ownerId : null,
        componentName:
          typeof props.componentName === "string" ? props.componentName : null,
        state: typeof props.state === "string" ? props.state : null,
        artifactKind:
          typeof props.artifactKind === "string" ? props.artifactKind : null,
        x: numberOrNull(state.x),
        y: numberOrNull(state.y),
        w: numberOrNull(props.w),
        h: numberOrNull(props.h),
        lastChangedClock: Number(row.lastChangedClock) || 0,
      } satisfies ScribeArtifactRecord;
    })
    .filter((record): record is ScribeArtifactRecord => Boolean(record));
}

export function selectScribeArtifactCleanup(
  artifacts: ScribeArtifactRecord[],
  { primaryArtifactId = DEFAULT_PRIMARY_ARTIFACT_ID } = {},
): ScribeArtifactCleanupSelection {
  const liveArtifacts = artifacts.filter((artifact) => artifact.state === "live");
  const primaryLive = liveArtifacts
    .filter((artifact) => artifact.artifactId === primaryArtifactId)
    .sort((left, right) => right.lastChangedClock - left.lastChangedClock);
  const keepPrimaryId = primaryLive[0]?.id ?? null;
  const cleanup = liveArtifacts
    .filter((artifact) => {
      if (artifact.artifactId !== primaryArtifactId) {
        return true;
      }
      return Boolean(keepPrimaryId && artifact.id !== keepPrimaryId);
    })
    .map((artifact) => ({
      ...artifact,
      reason:
        artifact.artifactId === primaryArtifactId
          ? "duplicate-primary-artifact"
          : "stale-live-artifact",
    }));

  return { keepPrimaryId, cleanup };
}

const runPythonJson = (script: string, args: string[]) => {
  const result = spawnSync("python3", ["-c", script, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || "python3 sqlite helper failed").trim(),
    );
  }
  return JSON.parse(result.stdout || "null");
};

const readScribeRows = (dbPath: string): ScribeDocumentRow[] =>
  runPythonJson(
    `
import json
import sqlite3
import sys

con = sqlite3.connect(sys.argv[1])
rows = []
for row_id, state, clock in con.execute("select id, state, lastChangedClock from documents where id like 'shape:artifact:%' order by lastChangedClock"):
    if isinstance(state, bytes):
        state = state.decode("utf-8")
    rows.append({"id": row_id, "state": state, "lastChangedClock": clock})
print(json.dumps(rows))
`,
    [dbPath],
  ) as ScribeDocumentRow[];

const cleanupScribeRows = (
  dbPath: string,
  backupPath: string,
  cleanupIds: string[],
) => {
  copyFileSync(dbPath, backupPath);
  return runPythonJson(
    `
import json
import sqlite3
import sys

db_path = sys.argv[1]
cleanup_ids = json.loads(sys.argv[2])
con = sqlite3.connect(db_path)
with con:
    row = con.execute("select documentClock from metadata limit 1").fetchone()
    clock = int(row[0]) if row else 0
    deleted = []
    for row_id in cleanup_ids:
        cur = con.execute("delete from documents where id = ?", (row_id,))
        if cur.rowcount:
            clock += 1
            con.execute(
                "insert or replace into tombstones(id, clock) values(?, ?)",
                (row_id, clock),
            )
            deleted.append(row_id)
    con.execute("update metadata set documentClock = ?", (clock,))
print(json.dumps({"deleted": deleted, "documentClock": clock}))
`,
    [dbPath, JSON.stringify(cleanupIds)],
  );
};

const buildAuditPayload = (
  artifacts: ScribeArtifactRecord[],
  selection: ScribeArtifactCleanupSelection,
  options: {
    dbPath: string;
    backupPath?: string | null;
    label?: string;
  },
) => ({
    dbPath: options.dbPath,
    backupPath: options.backupPath ?? null,
    label: options.label ?? "audit",
    artifacts,
    keepPrimaryId: selection.keepPrimaryId,
    cleanup: selection.cleanup,
});

const printAudit = (
  artifacts: ScribeArtifactRecord[],
  selection: ScribeArtifactCleanupSelection,
  options: {
    dbPath: string;
    backupPath?: string | null;
    json: boolean;
    label?: string;
  },
) => {
  const payload = buildAuditPayload(artifacts, selection, options);
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`[replit-scribe-artifacts] ${options.label ?? "audit"}`);
  console.log(`[replit-scribe-artifacts] db: ${options.dbPath}`);
  if (options.backupPath) {
    console.log(`[replit-scribe-artifacts] backup: ${options.backupPath}`);
  }
  console.log(
    `[replit-scribe-artifacts] artifact iframes: ${artifacts.length}; cleanup candidates: ${selection.cleanup.length}`,
  );
  for (const artifact of artifacts) {
    const action =
      selection.cleanup.find((item) => item.id === artifact.id)?.reason ||
      (artifact.id === selection.keepPrimaryId ? "keep-primary" : "keep");
    console.log(
      [
        `- ${action}`,
        artifact.id,
        `artifact=${artifact.artifactId}`,
        `state=${artifact.state ?? "unknown"}`,
        `clock=${artifact.lastChangedClock}`,
        `owner=${artifact.ownerId ?? "unknown"}`,
      ].join(" "),
    );
  }
};

const parseArgs = (argv: string[]) => {
  const options = {
    dbPath: DEFAULT_DB_PATH,
    primaryArtifactId: DEFAULT_PRIMARY_ARTIFACT_ID,
    backupAndClean: false,
    confirmControlPlaneCleanup: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") {
      options.dbPath = path.resolve(argv[++index] || "");
    } else if (arg === "--") {
      continue;
    } else if (arg === "--primary-artifact") {
      options.primaryArtifactId = argv[++index] || DEFAULT_PRIMARY_ARTIFACT_ID;
    } else if (arg === "--backup-and-clean") {
      options.backupAndClean = true;
    } else if (arg === CONTROL_PLANE_CLEANUP_CONFIRM_FLAG) {
      options.confirmControlPlaneCleanup = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        `Usage: pnpm --filter @workspace/scripts run replit:scribe:artifacts -- [--db PATH] [--json] [--backup-and-clean ${CONTROL_PLANE_CLEANUP_CONFIRM_FLAG}]`,
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
};

export function assertControlPlaneCleanupAllowed(options: {
  backupAndClean: boolean;
  confirmControlPlaneCleanup: boolean;
  env?: NodeJS.ProcessEnv;
}) {
  if (!options.backupAndClean) return;
  const env = options.env ?? process.env;
  const envAllowed = env[CONTROL_PLANE_CLEANUP_ENV] === "1";
  if (options.confirmControlPlaneCleanup && envAllowed) return;

  throw new Error(
    [
      "Refusing Scribe artifact cleanup: deleting artifact rows may trigger Replit artifact/env reconciliation and bounce the PYRUS app supervisor.",
      `Run read-only audit first, then set ${CONTROL_PLANE_CLEANUP_ENV}=1 and pass ${CONTROL_PLANE_CLEANUP_CONFIRM_FLAG} only during an explicit startup maintenance window.`,
    ].join(" "),
  );
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  assertControlPlaneCleanupAllowed(options);
  if (!existsSync(options.dbPath)) {
    throw new Error(`Scribe DB not found: ${options.dbPath}`);
  }

  const artifacts = parseScribeArtifactDocuments(readScribeRows(options.dbPath));
  const selection = selectScribeArtifactCleanup(artifacts, {
    primaryArtifactId: options.primaryArtifactId,
  });
  let backupPath: string | null = null;

  if (options.backupAndClean && selection.cleanup.length > 0) {
    const plannedPayload = buildAuditPayload(artifacts, selection, {
      dbPath: options.dbPath,
      backupPath: null,
      label: "planned cleanup",
    });
    if (!options.json) {
      printAudit(artifacts, selection, {
        dbPath: options.dbPath,
        backupPath: null,
        json: false,
        label: "planned cleanup",
      });
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    backupPath = `${options.dbPath}.backup-${timestamp}`;
    cleanupScribeRows(
      options.dbPath,
      backupPath,
      selection.cleanup.map((artifact) => artifact.id),
    );
    const remainingArtifacts = parseScribeArtifactDocuments(
      readScribeRows(options.dbPath),
    );
    const remainingSelection = selectScribeArtifactCleanup(remainingArtifacts, {
      primaryArtifactId: options.primaryArtifactId,
    });
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            planned: plannedPayload,
            postCleanup: buildAuditPayload(remainingArtifacts, remainingSelection, {
              dbPath: options.dbPath,
              backupPath,
              label: "post-cleanup audit",
            }),
          },
          null,
          2,
        ),
      );
      return;
    }
    printAudit(remainingArtifacts, remainingSelection, {
      dbPath: options.dbPath,
      backupPath,
      json: false,
      label: "post-cleanup audit",
    });
    return;
  }

  printAudit(artifacts, selection, {
    dbPath: options.dbPath,
    backupPath,
    json: options.json,
    label: "audit",
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(
      `[replit-scribe-artifacts] ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
