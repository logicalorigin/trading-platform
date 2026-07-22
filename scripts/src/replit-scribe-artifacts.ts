import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseArgs as parseNodeArgs,
  stripVTControlCharacters,
} from "node:util";

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
// ponytail: five seconds and 10 MiB bound this local helper; raise either only
// after measured Scribe state growth proves the current ceiling insufficient.
const SQLITE_HELPER_TIMEOUT_MS = 5_000;
const SQLITE_HELPER_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
// ponytail: 1,000 characters keeps terminal diagnostics useful but bounded;
// structured error artifacts are the upgrade path if truncation hides evidence.
const MAX_LOG_STRING_LENGTH = 1_000;
const UNSAFE_OUTPUT_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu;
const USAGE = `Usage: pnpm --filter @workspace/scripts run replit:scribe:artifacts -- [--db PATH] [--primary-artifact ID] [--json] [--backup-and-clean ${CONTROL_PLANE_CLEANUP_CONFIRM_FLAG}]`;

const safeText = (value: unknown) => {
  const cleaned = stripVTControlCharacters(String(value ?? ""))
    .replace(UNSAFE_OUTPUT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return cleaned.length <= MAX_LOG_STRING_LENGTH
    ? cleaned
    : `${cleaned.slice(0, MAX_LOG_STRING_LENGTH - 1)}…`;
};

const jsonText = (value: unknown) =>
  (JSON.stringify(value, null, 2) ?? "").replace(
    /[\u007f-\u009f\u2028-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, "0") ?? "fffd"}`,
  );

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
      if (typeof row.id !== "string" || !row.id.startsWith("shape:artifact:")) {
        return null;
      }
      const state = parseState(row.state);
      const props =
        state &&
        "props" in state &&
        state.props &&
        typeof state.props === "object"
          ? (state.props as Record<string, unknown>)
          : {};
      const artifactId =
        typeof props.artifactId === "string" ? props.artifactId : null;
      if (!artifactId || state?.type !== "iframe") {
        return null;
      }
      if (
        !Number.isSafeInteger(row.lastChangedClock) ||
        row.lastChangedClock < 0
      ) {
        throw new Error(`Invalid Scribe artifact clock: ${safeText(row.id)}`);
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
        lastChangedClock: row.lastChangedClock,
      } satisfies ScribeArtifactRecord;
    })
    .filter((record): record is ScribeArtifactRecord => Boolean(record));
}

export function selectScribeArtifactCleanup(
  artifacts: ScribeArtifactRecord[],
  { primaryArtifactId = DEFAULT_PRIMARY_ARTIFACT_ID } = {},
): ScribeArtifactCleanupSelection {
  const liveArtifacts = artifacts.filter(
    (artifact) => artifact.state === "live",
  );
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
    maxBuffer: SQLITE_HELPER_MAX_BUFFER_BYTES,
    timeout: SQLITE_HELPER_TIMEOUT_MS,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    throw new Error(
      code === "ETIMEDOUT"
        ? `python3 SQLite helper timed out after ${SQLITE_HELPER_TIMEOUT_MS}ms`
        : `Unable to run python3 SQLite helper: ${safeText(result.error.message)}`,
    );
  }
  if (result.status !== 0) {
    throw new Error(
      safeText(result.stderr || result.stdout) ||
        "python3 SQLite helper failed",
    );
  }
  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    throw new Error("Invalid JSON from python3 SQLite helper");
  }
};

const readScribeRows = (dbPath: string): ScribeDocumentRow[] => {
  const rows = runPythonJson(
    `
import json
from pathlib import Path
import sqlite3
import sys

con = sqlite3.connect(Path(sys.argv[1]).resolve().as_uri() + "?mode=ro", uri=True)
con.execute("pragma query_only=on")
rows = []
for row_id, state, clock in con.execute("select id, state, lastChangedClock from documents where id like 'shape:artifact:%' order by lastChangedClock"):
    if isinstance(state, bytes):
        state = state.decode("utf-8")
    rows.append({"id": row_id, "state": state, "lastChangedClock": clock})
print(json.dumps(rows))
`,
    [dbPath],
  );
  if (
    !Array.isArray(rows) ||
    rows.some(
      (row) =>
        !row ||
        typeof row !== "object" ||
        typeof row.id !== "string" ||
        !row.id.startsWith("shape:artifact:") ||
        typeof row.state !== "string" ||
        !Number.isSafeInteger(row.lastChangedClock) ||
        row.lastChangedClock < 0,
    )
  ) {
    throw new Error("Invalid Scribe row payload from python3 SQLite helper");
  }
  return rows as ScribeDocumentRow[];
};

const cleanupScribeRows = (
  dbPath: string,
  backupPath: string,
  auditedArtifacts: ScribeArtifactRecord[],
  cleanupArtifacts: ScribeArtifactRecord[],
) => {
  const expectedArtifact = (artifact: ScribeArtifactRecord) => ({
    id: artifact.id,
    artifactId: artifact.artifactId,
    state: artifact.state,
    lastChangedClock: artifact.lastChangedClock,
  });
  return runPythonJson(
    `
import json
import os
from pathlib import Path
import sqlite3
import stat
import sys

db_path = sys.argv[1]
backup_path = sys.argv[2]
audited_artifacts = json.loads(sys.argv[3])
cleanup_artifacts = json.loads(sys.argv[4])
con = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=rw", uri=True)
backup_complete = False

def current_artifact(row_id):
    row = con.execute(
        "select state, lastChangedClock from documents where id = ?",
        (row_id,),
    ).fetchone()
    if not row:
        return None
    try:
        state = row[0].decode("utf-8") if isinstance(row[0], bytes) else row[0]
        document = json.loads(state)
    except (TypeError, ValueError, UnicodeDecodeError):
        return None
    props = document.get("props") if isinstance(document, dict) else None
    if not isinstance(document, dict) or document.get("type") != "iframe" or not isinstance(props, dict):
        return None
    return {
        "artifactId": props.get("artifactId"),
        "state": props.get("state"),
        "lastChangedClock": row[1],
    }

def assert_unchanged(expected):
    current = current_artifact(expected["id"])
    if not current or any(
        current[key] != expected[key]
        for key in ("artifactId", "state", "lastChangedClock")
    ):
        raise RuntimeError(f"Scribe artifact changed since audit: {expected['id']}")

def assert_exact_artifacts(expected_artifacts):
    expected_ids = sorted(artifact["id"] for artifact in expected_artifacts)
    current_ids = [
        row[0]
        for row in con.execute(
            "select id from documents where id like 'shape:artifact:%' order by id"
        )
    ]
    if current_ids != expected_ids:
        raise RuntimeError("Scribe artifact set changed since audit")
    for artifact in expected_artifacts:
        assert_unchanged(artifact)

con.execute("begin immediate")
try:
    assert_exact_artifacts(audited_artifacts)
    fd = os.open(backup_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    backup_source = sqlite3.connect(
        Path(db_path).resolve().as_uri() + "?mode=ro",
        uri=True,
    )
    backup = sqlite3.connect(backup_path)
    try:
        backup_source.backup(backup)
    finally:
        backup.close()
        backup_source.close()
    os.chmod(backup_path, stat.S_IMODE(os.stat(db_path).st_mode))
    backup_complete = True
    metadata = con.execute("select rowid, documentClock from metadata").fetchall()
    if len(metadata) != 1:
        raise RuntimeError("Expected exactly one Scribe metadata row")
    metadata_rowid, clock = metadata[0]
    if not isinstance(clock, int) or clock < 0:
        raise RuntimeError("Expected a non-negative Scribe document clock")
    deleted = []
    for artifact in cleanup_artifacts:
        row_id = artifact["id"]
        cur = con.execute("delete from documents where id = ?", (row_id,))
        if cur.rowcount != 1:
            raise RuntimeError(f"Failed to delete audited Scribe artifact: {row_id}")
        clock += 1
        con.execute(
            "insert or replace into tombstones(id, clock) values(?, ?)",
            (row_id, clock),
        )
        deleted.append(row_id)
    cleanup_ids = {artifact["id"] for artifact in cleanup_artifacts}
    assert_exact_artifacts(
        [
            artifact
            for artifact in audited_artifacts
            if artifact["id"] not in cleanup_ids
        ]
    )
    con.execute(
        "update metadata set documentClock = ? where rowid = ?",
        (clock, metadata_rowid),
    )
    con.commit()
except BaseException:
    con.rollback()
    if not backup_complete and os.path.exists(backup_path):
        os.unlink(backup_path)
    raise
print(json.dumps({"deleted": deleted, "documentClock": clock}))
`,
    [
      dbPath,
      backupPath,
      JSON.stringify(auditedArtifacts.map(expectedArtifact)),
      JSON.stringify(cleanupArtifacts.map(expectedArtifact)),
    ],
  );
};

export const __replitScribeArtifactsInternalsForTests = {
  cleanupScribeRows,
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
    console.log(jsonText(payload));
    return;
  }

  console.log(`[replit-scribe-artifacts] ${options.label ?? "audit"}`);
  console.log(`[replit-scribe-artifacts] db: ${safeText(options.dbPath)}`);
  if (options.backupPath) {
    console.log(
      `[replit-scribe-artifacts] backup: ${safeText(options.backupPath)}`,
    );
  }
  console.log(
    `[replit-scribe-artifacts] artifact iframes: ${artifacts.length}; cleanup candidates: ${selection.cleanup.length}`,
  );
  const cleanupReasons = new Map(
    selection.cleanup.map((artifact) => [artifact.id, artifact.reason]),
  );
  for (const artifact of artifacts) {
    const action =
      cleanupReasons.get(artifact.id) ||
      (artifact.id === selection.keepPrimaryId ? "keep-primary" : "keep");
    console.log(
      [
        `- ${action}`,
        safeText(artifact.id),
        `artifact=${safeText(artifact.artifactId)}`,
        `state=${safeText(artifact.state ?? "unknown")}`,
        `clock=${artifact.lastChangedClock}`,
        `owner=${safeText(artifact.ownerId ?? "unknown")}`,
      ].join(" "),
    );
  }
};

const parseArgs = (argv: string[]) => {
  const { values, tokens } = parseNodeArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    tokens: true,
    options: {
      db: { type: "string" },
      "primary-artifact": { type: "string" },
      "backup-and-clean": { type: "boolean" },
      "confirm-control-plane-cleanup": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new Error(`Duplicate option: --${token.name}`);
    }
    seen.add(token.name);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  if (values.db !== undefined && !values.db.trim()) {
    throw new Error("Option --db requires a non-blank value");
  }
  if (
    values["primary-artifact"] !== undefined &&
    !values["primary-artifact"].trim()
  ) {
    throw new Error("Option --primary-artifact requires a non-blank value");
  }
  return {
    dbPath: values.db ? path.resolve(values.db) : DEFAULT_DB_PATH,
    primaryArtifactId:
      values["primary-artifact"] ?? DEFAULT_PRIMARY_ARTIFACT_ID,
    backupAndClean: values["backup-and-clean"] ?? false,
    confirmControlPlaneCleanup:
      values["confirm-control-plane-cleanup"] ?? false,
    json: values.json ?? false,
  };
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

  const rows = readScribeRows(options.dbPath);
  const artifacts = parseScribeArtifactDocuments(rows);
  if (options.backupAndClean && artifacts.length !== rows.length) {
    const count = rows.length - artifacts.length;
    throw new Error(
      `Refusing Scribe artifact cleanup: ${count} queried document${count === 1 ? " was" : "s were"} not a recognized iframe artifact`,
    );
  }
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
    cleanupScribeRows(options.dbPath, backupPath, artifacts, selection.cleanup);
    const remainingArtifacts = parseScribeArtifactDocuments(
      readScribeRows(options.dbPath),
    );
    const remainingSelection = selectScribeArtifactCleanup(remainingArtifacts, {
      primaryArtifactId: options.primaryArtifactId,
    });
    if (remainingSelection.cleanup.length > 0) {
      const count = remainingSelection.cleanup.length;
      throw new Error(
        `Scribe artifact cleanup incomplete: ${count} candidate${count === 1 ? "" : "s"} remains; backup: ${backupPath}`,
      );
    }
    if (options.json) {
      console.log(
        jsonText({
          planned: plannedPayload,
          postCleanup: buildAuditPayload(
            remainingArtifacts,
            remainingSelection,
            {
              dbPath: options.dbPath,
              backupPath,
              label: "post-cleanup audit",
            },
          ),
        }),
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
      `[replit-scribe-artifacts] ${
        safeText(error instanceof Error ? error.message : error) ||
        "Unknown error"
      }`,
    );
    process.exit(1);
  });
}
