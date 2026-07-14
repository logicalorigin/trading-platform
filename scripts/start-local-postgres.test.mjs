import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const TARGET = resolve("scripts/start-local-postgres.sh");

function writeExecutable(path, source) {
  writeFileSync(path, source);
  chmodSync(path, 0o755);
}

function runScenario({
  lockPid,
  pgStatus = "3",
  postmasterPid,
  psLive = "0",
  psqlMode = "ready",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "start-local-postgres-test-"));
  const fakeBin = join(root, "bin");
  const pgRoot = join(root, "postgres");
  const dataDir = join(pgRoot, "data");
  const runDir = join(pgRoot, "run");
  const callLog = join(root, "calls.log");
  const countFile = join(root, "psql-count");
  mkdirSync(fakeBin);
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(dataDir, "PG_VERSION"), "16\n");

  if (postmasterPid !== undefined) {
    writeFileSync(join(dataDir, "postmaster.pid"), `${postmasterPid}\n`);
    writeFileSync(join(runDir, ".s.PGSQL.5432"), "socket\n");
  }
  if (lockPid !== undefined) {
    writeFileSync(join(runDir, ".s.PGSQL.5432.lock"), `${lockPid}\n`);
  }

  writeExecutable(
    join(fakeBin, "timeout"),
    `#!/usr/bin/env bash
printf 'timeout|%s|%s|connect=%s\\n' "\${1:-}" "\${2:-}" "\${PGCONNECT_TIMEOUT:-}" >>"$CALL_LOG"
shift 2
exec "$@"
`,
  );
  writeExecutable(
    join(fakeBin, "psql"),
    `#!/usr/bin/env bash
count=0
if [ -f "$PSQL_COUNT_FILE" ]; then read -r count <"$PSQL_COUNT_FILE"; fi
count=$((count + 1))
printf '%s\\n' "$count" >"$PSQL_COUNT_FILE"
printf 'psql|portenv=%s|' "\${PGPORT:-}" >>"$CALL_LOG"
printf '%q ' "$@" >>"$CALL_LOG"
printf '\\n' >>"$CALL_LOG"
case "$PSQL_MODE" in
  unreachable) exit 1 ;;
  stale-start)
    if [ "$count" -eq 1 ]; then exit 1; fi
    printf '1\\n'
    ;;
  query-fail)
    case "$*" in
      *"SELECT 1 FROM pg_database"*) exit 70 ;;
      *"CREATE DATABASE dev"*) exit 0 ;;
      *) printf '1\\n' ;;
    esac
    ;;
  *) printf '1\\n' ;;
esac
`,
  );
  writeExecutable(
    join(fakeBin, "pg_ctl"),
    `#!/usr/bin/env bash
printf 'pg_ctl|' >>"$CALL_LOG"
printf '%q ' "$@" >>"$CALL_LOG"
printf '\\n' >>"$CALL_LOG"
case " $* " in
  *" status "*) exit "$PG_STATUS" ;;
  *" start "*)
    if [ -e "$PGROOT/data/postmaster.pid" ] || [ -e "$PGROOT/run/.s.PGSQL.5432" ] || [ -e "$PGROOT/run/.s.PGSQL.5432.lock" ]; then
      printf 'pg_ctl_start_with_existing_artifacts\\n' >>"$CALL_LOG"
      exit 90
    fi
    printf '999\\n' >"$PGROOT/data/postmaster.pid"
    printf 'fresh-socket\\n' >"$PGROOT/run/.s.PGSQL.5432"
    printf '999\\n' >"$PGROOT/run/.s.PGSQL.5432.lock"
    exit 0
    ;;
  *) exit 0 ;;
esac
`,
  );
  writeExecutable(
    join(fakeBin, "ps"),
    `#!/usr/bin/env bash
printf 'ps|' >>"$CALL_LOG"
printf '%q ' "$@" >>"$CALL_LOG"
printf '\\n' >>"$CALL_LOG"
if [ "$PS_LIVE" = "1" ]; then
  case "$*" in *"comm="*) printf 'postgres\\n' ;; *) printf '%s\\n' "\${2:-1}" ;; esac
  exit 0
fi
exit 1
`,
  );

  const result = spawnSync("bash", [TARGET], {
    cwd: resolve("."),
    encoding: "utf8",
    env: {
      ...process.env,
      CALL_LOG: callLog,
      PATH: `${fakeBin}:${process.env.PATH}`,
      PGROOT: pgRoot,
      PGPORT: "6543",
      PG_STATUS: pgStatus,
      PS_LIVE: psLive,
      PSQL_COUNT_FILE: countFile,
      PSQL_MODE: psqlMode,
    },
    timeout: 5_000,
  });

  return {
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    calls: existsSync(callLog) ? readFileSync(callLog, "utf8") : "",
    dataDir,
    result,
    runDir,
  };
}

test("pins the local port and bounds every SQL probe", () => {
  const scenario = runScenario();
  try {
    assert.equal(scenario.result.status, 0, scenario.result.stderr);
    assert.match(scenario.result.stdout, /[?&]port=5432(?:\s|$)/);
    assert.equal(
      (
        scenario.calls.match(/^timeout\|--kill-after=1s\|5s\|connect=5$/gm) ??
        []
      ).length,
      2,
    );
    assert.equal(
      (scenario.calls.match(/^psql\|portenv=5432\|/gm) ?? []).length,
      2,
    );
    assert.doesNotMatch(scenario.calls, /portenv=6543/);
    assert.equal((scenario.calls.match(/ -p 5432 /g) ?? []).length, 2);
  } finally {
    scenario.cleanup();
  }
});

test("preserves artifacts when PostgreSQL reports a live cluster", () => {
  const scenario = runScenario({
    lockPid: "123",
    pgStatus: "0",
    postmasterPid: "123",
    psqlMode: "unreachable",
  });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(join(scenario.dataDir, "postmaster.pid")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432.lock")), true);
    assert.doesNotMatch(scenario.calls, /pg_ctl\|.* start /);
  } finally {
    scenario.cleanup();
  }
});

test("preserves artifacts when pg_ctl cannot prove the cluster is stopped", () => {
  const scenario = runScenario({
    lockPid: "123",
    pgStatus: "1",
    postmasterPid: "123",
    psqlMode: "unreachable",
  });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(join(scenario.dataDir, "postmaster.pid")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432.lock")), true);
    assert.doesNotMatch(scenario.calls, /^ps\|/m);
    assert.doesNotMatch(scenario.calls, /pg_ctl\|.* start /);
  } finally {
    scenario.cleanup();
  }
});

test("preserves artifacts when the recorded postmaster PID is live", () => {
  const scenario = runScenario({
    lockPid: "123",
    postmasterPid: "123",
    psLive: "1",
    psqlMode: "unreachable",
  });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(join(scenario.dataDir, "postmaster.pid")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432")), true);
    assert.doesNotMatch(scenario.calls, /pg_ctl\|.* start /);
  } finally {
    scenario.cleanup();
  }
});

test("rejects a noncanonical postmaster PID without invoking ps or deleting", () => {
  const scenario = runScenario({
    lockPid: "not-a-pid",
    postmasterPid: "not-a-pid",
    psqlMode: "unreachable",
  });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(join(scenario.dataDir, "postmaster.pid")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432.lock")), true);
    assert.doesNotMatch(scenario.calls, /^ps\|/m);
    assert.doesNotMatch(scenario.calls, /pg_ctl\|.* start /);
  } finally {
    scenario.cleanup();
  }
});

test("rejects mismatched stale socket ownership without deleting it", () => {
  const scenario = runScenario({
    lockPid: "456",
    postmasterPid: "123",
    psqlMode: "unreachable",
  });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.equal(existsSync(join(scenario.dataDir, "postmaster.pid")), true);
    assert.equal(existsSync(join(scenario.runDir, ".s.PGSQL.5432.lock")), true);
    assert.doesNotMatch(scenario.calls, /pg_ctl\|.* start /);
  } finally {
    scenario.cleanup();
  }
});

test("clears only self-consistent dead artifacts before a pinned-port start", () => {
  const scenario = runScenario({
    lockPid: "123",
    postmasterPid: "123",
    psqlMode: "stale-start",
  });
  try {
    assert.equal(scenario.result.status, 0, scenario.result.stderr);
    assert.equal(
      readFileSync(join(scenario.dataDir, "postmaster.pid"), "utf8"),
      "999\n",
    );
    assert.equal(
      readFileSync(join(scenario.runDir, ".s.PGSQL.5432.lock"), "utf8"),
      "999\n",
    );
    assert.match(scenario.calls, /pg_ctl\|.* -o -p\\ 5432 .* start /);
    assert.doesNotMatch(scenario.calls, /pg_ctl_start_with_existing_artifacts/);
  } finally {
    scenario.cleanup();
  }
});

test("does not turn a failed existence query into CREATE DATABASE", () => {
  const scenario = runScenario({ psqlMode: "query-fail" });
  try {
    assert.notEqual(scenario.result.status, 0);
    assert.doesNotMatch(scenario.calls, /CREATE\\ DATABASE\\ dev/);
  } finally {
    scenario.cleanup();
  }
});
