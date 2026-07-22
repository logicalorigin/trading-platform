import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  __replitScribeArtifactsInternalsForTests as internals,
  assertControlPlaneCleanupAllowed,
  parseScribeArtifactDocuments,
  selectScribeArtifactCleanup,
} from "./replit-scribe-artifacts";

const scriptPath = resolve(import.meta.dirname, "replit-scribe-artifacts.ts");

const runCli = (args: string[], env: NodeJS.ProcessEnv = process.env) =>
  spawnSync(process.execPath, ["--import", "tsx", scriptPath, ...args], {
    cwd: resolve(import.meta.dirname, ".."),
    encoding: "utf8",
    env,
    timeout: 10_000,
  });

const queryDocumentIds = (dbPath: string) => {
  const result = spawnSync(
    "python3",
    [
      "-c",
      [
        "import json, sqlite3, sys",
        "con = sqlite3.connect(sys.argv[1])",
        "print(json.dumps([row[0] for row in con.execute('select id from documents order by id')]))",
      ].join("\n"),
      dbPath,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as string[];
};

const startWalFixture = async (dbPath: string) => {
  const child = spawn(
    "python3",
    [
      "-c",
      `
import json
import sqlite3
import sys

con = sqlite3.connect(sys.argv[1])
con.execute("pragma journal_mode=wal")
con.execute("pragma wal_autocheckpoint=0")
con.execute("create table documents(id text primary key, state text not null, lastChangedClock integer not null)")
con.execute("create table metadata(documentClock integer not null)")
con.execute("create table tombstones(id text primary key, clock integer not null)")
con.execute("insert into metadata(documentClock) values(10)")
con.commit()
con.execute("pragma wal_checkpoint(truncate)")

def state(artifact_id):
    return json.dumps({
        "type": "iframe",
        "props": {
            "artifactId": artifact_id,
            "state": "live",
            "ownerId": "fixture-owner",
        },
    })

con.execute(
    "insert into documents(id, state, lastChangedClock) values(?, ?, ?)",
    ("shape:artifact:pyrus-old", state("artifacts/pyrus"), 11),
)
con.execute(
    "insert into documents(id, state, lastChangedClock) values(?, ?, ?)",
    ("shape:artifact:pyrus-new", state("artifacts/pyrus"), 12),
)
con.commit()
print("ready", flush=True)
sys.stdin.readline()
con.close()
`,
      dbPath,
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding("utf8");
  await new Promise<void>((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (code) =>
      reject(new Error(`WAL fixture exited ${code}: ${stderr}`)),
    );
    child.stdout.once("data", (chunk) => {
      if (String(chunk).includes("ready")) accept();
      else reject(new Error(`Unexpected WAL fixture output: ${chunk}`));
    });
  });
  return child;
};

const row = (
  id: string,
  artifactId: string,
  clock: number,
  state = "live",
) => ({
  id,
  lastChangedClock: clock,
  state: JSON.stringify({
    id,
    type: "iframe",
    x: clock,
    y: clock,
    props: {
      w: 100,
      h: 100,
      state,
      artifactId,
      ownerId: `owner-${clock}`,
      componentName: artifactId,
      artifactKind: "web",
    },
  }),
});

test("scribe artifact audit parses iframe artifact documents", () => {
  const artifacts = parseScribeArtifactDocuments([
    row("shape:artifact:old", "artifacts/legacy-preview", 1),
    row("shape:artifact:pyrus", "artifacts/pyrus", 2),
    {
      id: "shape:text",
      lastChangedClock: 3,
      state: JSON.stringify({ id: "shape:text", type: "text", props: {} }),
    },
  ]);

  assert.deepEqual(
    artifacts.map((artifact) => artifact.id),
    ["shape:artifact:old", "shape:artifact:pyrus"],
  );
  assert.equal(artifacts[1]?.artifactId, "artifacts/pyrus");
  assert.equal(artifacts[1]?.state, "live");
});

test("read-only parsing ignores non-iframe documents but rejects unsafe clocks", () => {
  assert.deepEqual(
    parseScribeArtifactDocuments([
      {
        id: "shape:artifact:unrecognized",
        lastChangedClock: 1,
        state: "not-json",
      },
    ]),
    [],
  );

  assert.throws(
    () =>
      parseScribeArtifactDocuments([
        row(
          "shape:artifact:unsafe-clock",
          "artifacts/pyrus",
          Number.MAX_SAFE_INTEGER + 1,
        ),
      ]),
    /Invalid Scribe artifact clock: shape:artifact:unsafe-clock/,
  );
});

test("scribe artifact cleanup keeps newest live PYRUS iframe and selects stale live artifacts", () => {
  const artifacts = parseScribeArtifactDocuments([
    row("shape:artifact:legacy", "artifacts/legacy-preview", 5),
    row("shape:artifact:pyrus-old", "artifacts/pyrus", 10),
    row("shape:artifact:pyrus-new", "artifacts/pyrus", 11),
    row("shape:artifact:pyrus-closed", "artifacts/pyrus", 12, "closed"),
  ]);
  const selection = selectScribeArtifactCleanup(artifacts);

  assert.equal(selection.keepPrimaryId, "shape:artifact:pyrus-new");
  assert.deepEqual(
    selection.cleanup.map((artifact) => [artifact.id, artifact.reason]),
    [
      ["shape:artifact:legacy", "stale-live-artifact"],
      ["shape:artifact:pyrus-old", "duplicate-primary-artifact"],
    ],
  );
});

test("scribe artifact cleanup requires explicit control-plane maintenance approval", () => {
  assert.doesNotThrow(() =>
    assertControlPlaneCleanupAllowed({
      backupAndClean: false,
      confirmControlPlaneCleanup: false,
      env: {},
    }),
  );

  assert.throws(
    () =>
      assertControlPlaneCleanupAllowed({
        backupAndClean: true,
        confirmControlPlaneCleanup: false,
        env: { PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP: "1" },
      }),
    /explicit startup maintenance window/,
  );
  assert.throws(
    () =>
      assertControlPlaneCleanupAllowed({
        backupAndClean: true,
        confirmControlPlaneCleanup: true,
        env: {},
      }),
    /PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP=1/,
  );
  assert.doesNotThrow(() =>
    assertControlPlaneCleanupAllowed({
      backupAndClean: true,
      confirmControlPlaneCleanup: true,
      env: { PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP: "1" },
    }),
  );
});

test("CLI rejects missing option values before opening Scribe state", () => {
  const missingDb = runCli(["--db"]);
  assert.equal(missingDb.status, 1);
  assert.match(
    missingDb.stderr,
    /--db.*(?:argument missing|requires a value)/i,
  );
  assert.doesNotMatch(missingDb.stderr, /Scribe DB not found|sqlite/i);

  const missingPrimary = runCli([
    "--db",
    resolve(import.meta.dirname, "missing-scribe.db"),
    "--primary-artifact",
    "--json",
  ]);
  assert.equal(missingPrimary.status, 1);
  assert.match(missingPrimary.stderr, /--primary-artifact[\s\S]*argument/i);
  assert.doesNotMatch(missingPrimary.stderr, /Scribe DB not found|sqlite/i);
});

test("CLI rejects duplicate value-bearing options", () => {
  const result = runCli([
    "--db",
    resolve(import.meta.dirname, "first-missing-scribe.db"),
    "--db",
    resolve(import.meta.dirname, "second-missing-scribe.db"),
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Duplicate (?:argument|option): --db/i);
  assert.doesNotMatch(result.stderr, /Scribe DB not found|sqlite/i);
});

test("backup-and-clean captures committed WAL rows before cleanup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-artifacts-"));
  const dbPath = join(directory, "scribe.db");
  const writer = await startWalFixture(dbPath);

  try {
    const result = runCli(
      [
        "--db",
        dbPath,
        "--backup-and-clean",
        "--confirm-control-plane-cleanup",
        "--json",
      ],
      {
        ...process.env,
        PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP: "1",
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const payload = JSON.parse(result.stdout) as {
      postCleanup: { backupPath: string };
    };

    assert.deepEqual(queryDocumentIds(payload.postCleanup.backupPath), [
      "shape:artifact:pyrus-new",
      "shape:artifact:pyrus-old",
    ]);
    assert.deepEqual(queryDocumentIds(dbPath), ["shape:artifact:pyrus-new"]);
  } finally {
    const exited = once(writer, "exit");
    writer.stdin.end();
    await exited;
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup aborts atomically when an audited artifact changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-race-"));
  const dbPath = join(directory, "scribe.db");
  const backupPath = join(directory, "scribe.backup.db");
  const writer = await startWalFixture(dbPath);
  const exited = once(writer, "exit");
  writer.stdin.end();
  await exited;

  try {
    const artifacts = parseScribeArtifactDocuments([
      row("shape:artifact:pyrus-old", "artifacts/pyrus", 11),
      row("shape:artifact:pyrus-new", "artifacts/pyrus", 12),
    ]);
    const selection = selectScribeArtifactCleanup(artifacts);
    const changed = spawnSync(
      "python3",
      [
        "-c",
        [
          "import json, sqlite3, sys",
          "con = sqlite3.connect(sys.argv[1])",
          "state = json.loads(con.execute('select state from documents where id = ?', ('shape:artifact:pyrus-old',)).fetchone()[0])",
          "state['props']['state'] = 'closed'",
          "con.execute('update documents set state = ?, lastChangedClock = 13 where id = ?', (json.dumps(state), 'shape:artifact:pyrus-old'))",
          "con.commit()",
        ].join("\n"),
        dbPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(changed.status, 0, changed.stderr);

    assert.throws(
      () =>
        internals.cleanupScribeRows(
          dbPath,
          backupPath,
          artifacts,
          selection.cleanup,
        ),
      /Scribe artifact changed since audit: shape:artifact:pyrus-old/,
    );
    assert.deepEqual(queryDocumentIds(dbPath), [
      "shape:artifact:pyrus-new",
      "shape:artifact:pyrus-old",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("malformed SQLite helper output fails with a safe diagnostic", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-helper-"));
  const dbPath = join(directory, "scribe.db");
  const fakePython = join(directory, "python3");
  await writeFile(dbPath, "fixture", "utf8");
  await writeFile(
    fakePython,
    "#!/bin/sh\nprintf '\\033[31mnot-json\\033[0m'\n",
    "utf8",
  );
  await chmod(fakePython, 0o755);

  try {
    const result = runCli(["--db", dbPath], {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid JSON from python3 SQLite helper/);
    assert.doesNotMatch(
      result.stderr,
      /[\u001b\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("operator errors are bounded and terminal-safe", () => {
  const unsafeName = `missing-\u001b[31mred\u001b[0m-\u202esecret-${"x".repeat(2_000)}.db`;
  const result = runCli(["--db", resolve(import.meta.dirname, unsafeName)]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Scribe DB not found/);
  assert.doesNotMatch(
    result.stderr,
    /[\u001b\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(
    result.stderr.length <= 1_100,
    `stderr was ${result.stderr.length}`,
  );
});

test("SQLite helper payloads are validated before artifact parsing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-payload-"));
  const dbPath = join(directory, "scribe.db");
  const fakePython = join(directory, "python3");
  await writeFile(dbPath, "fixture", "utf8");
  await writeFile(fakePython, "#!/bin/sh\nprintf '{}'\n", "utf8");
  await chmod(fakePython, 0o755);

  try {
    const result = runCli(["--db", dbPath], {
      ...process.env,
      PATH: `${directory}:${process.env.PATH ?? ""}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid Scribe row payload/);
    assert.doesNotMatch(result.stderr, /rows\.map|TypeError/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup exits nonzero when a raced duplicate remains", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-survivor-"));
  const dbPath = join(directory, "scribe.db");
  const writer = await startWalFixture(dbPath);
  const exited = once(writer, "exit");
  writer.stdin.end();
  await exited;

  try {
    const trigger = spawnSync(
      "python3",
      [
        "-c",
        `
import sqlite3
import sys

con = sqlite3.connect(sys.argv[1])
con.execute('''
create trigger race_duplicate after delete on documents
when old.id = 'shape:artifact:pyrus-old'
begin
  insert into documents(id, state, lastChangedClock)
  values(
    'shape:artifact:pyrus-raced',
    '{"type":"iframe","props":{"artifactId":"artifacts/pyrus","state":"live","ownerId":"fixture-owner"}}',
    13
  );
end
''')
con.commit()
`,
        dbPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(trigger.status, 0, trigger.stderr);

    const result = runCli(
      [
        "--db",
        dbPath,
        "--backup-and-clean",
        "--confirm-control-plane-cleanup",
        "--json",
      ],
      {
        ...process.env,
        PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP: "1",
      },
    );
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Scribe artifact set changed since audit/);
    assert.deepEqual(queryDocumentIds(dbPath), [
      "shape:artifact:pyrus-new",
      "shape:artifact:pyrus-old",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("backup and cleanup share one write-reserved preimage", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-preimage-"));
  const dbPath = join(directory, "scribe.db");
  const backupPath = join(directory, "scribe.backup.db");
  const fixture = await startWalFixture(dbPath);
  const fixtureExited = once(fixture, "exit");
  fixture.stdin.end();
  await fixtureExited;
  const artifacts = parseScribeArtifactDocuments([
    row("shape:artifact:pyrus-old", "artifacts/pyrus", 11),
    row("shape:artifact:pyrus-new", "artifacts/pyrus", 12),
  ]);
  const selection = selectScribeArtifactCleanup(artifacts);
  const writer = spawn(
    "python3",
    [
      "-c",
      `
import sqlite3
import sys
import time

con = sqlite3.connect(sys.argv[1])
con.execute("begin immediate")
con.execute("insert into documents(id, state, lastChangedClock) values('shape:text:concurrent', '{}', 20)")
print("ready", flush=True)
time.sleep(0.75)
con.commit()
con.close()
`,
      dbPath,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const writerExited = once(writer, "exit");
  await once(writer.stdout, "data");

  try {
    internals.cleanupScribeRows(
      dbPath,
      backupPath,
      artifacts,
      selection.cleanup,
    );
    await writerExited;
    assert.deepEqual(queryDocumentIds(backupPath), [
      "shape:artifact:pyrus-new",
      "shape:artifact:pyrus-old",
      "shape:text:concurrent",
    ]);
    assert.deepEqual(queryDocumentIds(dbPath), [
      "shape:artifact:pyrus-new",
      "shape:text:concurrent",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("JSON audit output escapes physical line separators", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-json-"));
  const dbPath = join(directory, "scribe.db");
  const fixture = await startWalFixture(dbPath);
  const fixtureExited = once(fixture, "exit");
  fixture.stdin.end();
  await fixtureExited;

  try {
    const updated = spawnSync(
      "python3",
      [
        "-c",
        [
          "import json, sqlite3, sys",
          "con = sqlite3.connect(sys.argv[1])",
          "state = json.loads(con.execute(\"select state from documents where id = 'shape:artifact:pyrus-new'\").fetchone()[0])",
          "state['props']['ownerId'] = 'before\\u2028middle\\u2029after'",
          "con.execute(\"update documents set state = ? where id = 'shape:artifact:pyrus-new'\", (json.dumps(state),))",
          "con.commit()",
        ].join("\n"),
        dbPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(updated.status, 0, updated.stderr);
    const result = runCli(["--db", dbPath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /[\u2028\u2029]/u);
    assert.match(result.stdout, /\\u2028middle\\u2029/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("cleanup refuses to omit an unrecognized artifact document", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pyrus-scribe-unrecognized-"));
  const dbPath = join(directory, "scribe.db");
  const writer = await startWalFixture(dbPath);
  const exited = once(writer, "exit");
  writer.stdin.end();
  await exited;

  try {
    const inserted = spawnSync(
      "python3",
      [
        "-c",
        [
          "import sqlite3, sys",
          "con = sqlite3.connect(sys.argv[1])",
          "con.execute(\"insert into documents(id, state, lastChangedClock) values('shape:artifact:unrecognized', 'not-json', 13)\")",
          "con.commit()",
        ].join("\n"),
        dbPath,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    assert.equal(inserted.status, 0, inserted.stderr);

    const result = runCli(
      ["--db", dbPath, "--backup-and-clean", "--confirm-control-plane-cleanup"],
      {
        ...process.env,
        PYRUS_ALLOW_REPLIT_CONTROL_PLANE_CLEANUP: "1",
      },
    );
    assert.equal(result.status, 1);
    assert.match(
      result.stderr,
      /Refusing Scribe artifact cleanup: 1 queried document was not a recognized iframe artifact/,
    );
    assert.deepEqual(queryDocumentIds(dbPath), [
      "shape:artifact:pyrus-new",
      "shape:artifact:pyrus-old",
      "shape:artifact:unrecognized",
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
