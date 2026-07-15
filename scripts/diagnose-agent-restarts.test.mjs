import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReport,
  collectCodexSqliteLogActivity,
  collectCodexSessionActivity,
  parseRestartArgs,
  selectRecentFiles,
  selectedRanges,
} from "./diagnose-agent-restarts.mjs";

test("strict CLI parsing rejects duplicates and unsafe numeric bounds", () => {
  const nowMs = Date.parse("2026-07-15T00:00:00.000Z");
  const parsed = parseRestartArgs(
    ["--since", "2h", "--window-minutes", "0.5", "--json"],
    nowMs,
  );
  assert.equal(parsed.since.toISOString(), "2026-07-14T22:00:00.000Z");
  assert.equal(parsed.windowMs, 30_000);
  assert.equal(parsed.json, true);

  assert.throws(
    () => parseRestartArgs(["--json", "--json"], nowMs),
    /duplicate.*json/i,
  );
  assert.throws(
    () => parseRestartArgs(["--since", "1h", "--since", "2h"], nowMs),
    /duplicate.*since/i,
  );
  assert.throws(
    () => parseRestartArgs(["--window-minutes", "1e308"], nowMs),
    /window-minutes.*safe/i,
  );
  assert.throws(
    () => parseRestartArgs(["--unknown"], nowMs),
    /unknown|option/i,
  );
  for (const option of [
    "dir",
    "codex-dir",
    "workflow-log-dir",
    "since",
    "around",
    "window-minutes",
  ]) {
    assert.throws(
      () => parseRestartArgs([`--${option}=`], nowMs),
      new RegExp(option, "i"),
    );
  }
});

test("saturates selected evidence windows inside the JavaScript Date domain", () => {
  const ranges = selectedRanges({
    around: new Date(8_640_000_000_000_000),
    since: new Date(0),
    windowMs: 8_640_000_000_000_000,
  });

  assert.deepEqual(ranges, {
    incident: { startMs: 0, endMs: 8_640_000_000_000_000 },
    evidence: { startMs: 0, endMs: 8_640_000_000_000_000 },
  });
  for (const range of Object.values(ranges)) {
    assert.ok(Number.isSafeInteger(range.startMs));
    assert.ok(Number.isSafeInteger(range.endMs));
  }
});

test("marks evidence incomplete when a discovered file vanishes before stat", () => {
  const warnings = [];
  const missingPath = path.join(
    tmpdir(),
    `restart-diagnostic-vanished-${process.pid}`,
  );

  const selected = selectRecentFiles(
    [missingPath],
    { startMs: 0, endMs: Date.now() },
    10,
    warnings,
    "Codex session",
  );

  assert.deepEqual(selected, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Codex session.*unavailable.*ENOENT/i);
});

test("reads current custom tool calls and flattens text-block outputs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-diagnostic-"));
  const codexDir = path.join(root, "codex");
  const sessionsDir = path.join(codexDir, "sessions", "fixture");
  const rolloutPath = path.join(sessionsDir, "rollout-fixture.jsonl");
  mkdirSync(sessionsDir, { recursive: true });
  const entries = [
    {
      timestamp: "2026-07-12T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        call_id: "fixture-call",
        name: "exec",
        input:
          'const [a, b] = await Promise.all([tools.exec_command({cmd:"REPLIT_MODE=workflow pnpm dev:replit --token=fixture-command-token"}), tools.exec_command({cmd:"node browser.newPage fixture"})]); text(a.output); text(b.output);',
      },
    },
    {
      timestamp: "2026-07-12T00:00:01.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call_output",
        call_id: "fixture-call",
        output: [
          {
            type: "input_text",
            text: "Process running with session id fixture-session\n",
          },
          {
            type: "input_text",
            text: "authorization: Bearer fixture-output-token",
          },
        ],
      },
    },
  ];
  writeFileSync(
    rolloutPath,
    `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
  );

  try {
    const activities = collectCodexSessionActivity(codexDir);
    assert.ok(
      activities.some((entry) => entry.categories.includes("workflow-risk")),
    );
    assert.ok(
      activities.some((entry) => entry.categories.includes("browser-risk")),
    );
    assert.ok(
      activities.some((entry) => entry.categories.includes("resource-risk")),
    );
    assert.doesNotMatch(
      JSON.stringify(activities),
      /fixture-command-token|fixture-output-token/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("session evidence is time-filtered, tail-bounded, and reports unknown exec shapes", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-session-bounds-"));
  const codexDir = path.join(root, "codex");
  const sessionsDir = path.join(codexDir, "sessions", "fixture");
  const rolloutPath = path.join(sessionsDir, "rollout-fixture.jsonl");
  mkdirSync(sessionsDir, { recursive: true });
  const recent = {
    timestamp: "2026-07-15T00:00:00.000Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input:
        'tools.exec_command(dynamicCommand); tools.exec_command({cmd:"pnpm dev:replit"})',
    },
  };
  writeFileSync(
    rolloutPath,
    `${"discarded-prefix".repeat(100_000)}\n${JSON.stringify(recent)}\n`,
  );

  try {
    const warnings = [];
    const activities = collectCodexSessionActivity(
      codexDir,
      {
        startMs: Date.parse("2026-07-14T23:00:00.000Z"),
        endMs: Date.parse("2026-07-15T01:00:00.000Z"),
      },
      warnings,
    );
    assert.equal(activities.length, 1);
    assert.match(activities[0]?.summary ?? "", /pnpm dev:replit/u);
    assert.ok(warnings.some((warning) => /bounded tail/i.test(warning)));
    assert.ok(
      warnings.some((warning) => /unparsed exec invocation/i.test(warning)),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("caps retained risk activity and keeps the newest matching evidence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-activity-cap-"));
  const codexDir = path.join(root, "codex");
  const sessionsDir = path.join(codexDir, "sessions", "fixture");
  const rolloutPath = path.join(sessionsDir, "rollout-fixture.jsonl");
  const startMs = Date.parse("2026-07-15T00:00:00.000Z");
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    rolloutPath,
    `${Array.from({ length: 1_001 }, (_, index) =>
      JSON.stringify({
        timestamp: new Date(startMs + index).toISOString(),
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          arguments: JSON.stringify({ cmd: "pnpm dev:replit" }),
        },
      }),
    ).join("\n")}\n`,
  );

  try {
    const warnings = [];
    const activities = collectCodexSessionActivity(
      codexDir,
      { startMs, endMs: startMs + 2_000 },
      warnings,
    );
    assert.equal(activities.length, 1_000);
    assert.equal(activities[0]?.timestampMs, startMs + 1);
    assert.equal(activities.at(-1)?.timestampMs, startMs + 1_000);
    assert.ok(
      warnings.some((warning) => /activity.*capped.*1000/i.test(warning)),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("SQLite evidence is read-only, bounded, ranged, and timeout-protected", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-sqlite-bounds-"));
  const codexDir = path.join(root, "codex");
  const sqlitePath = path.join(codexDir, "logs_fixture.sqlite");
  mkdirSync(codexDir, { recursive: true });
  writeFileSync(sqlitePath, "fixture");
  const calls = [];
  const fakeSpawn = (command, args, options) => {
    calls.push({ command, args, options });
    return {
      status: 0,
      stdout: `${JSON.stringify({
        ts: Date.parse("2026-07-15T00:00:00.000Z") / 1000,
        ts_nanos: 0,
        level: "error",
        target: "workflow",
        message: "workflow failed",
      })}\n${JSON.stringify({
        ts: Date.parse("2020-01-01T00:00:00.000Z") / 1000,
        ts_nanos: 0,
        level: "error",
        target: "workflow",
        message: "old workflow failed",
      })}\n`,
      stderr: "",
    };
  };

  try {
    const warnings = [];
    const activities = collectCodexSqliteLogActivity(
      codexDir,
      {
        startMs: Date.parse("2026-07-14T23:00:00.000Z"),
        endMs: Date.parse("2026-07-15T01:00:00.000Z"),
      },
      warnings,
      fakeSpawn,
    );
    assert.equal(activities.length, 1);
    assert.equal(warnings.length, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.command, "python");
    assert.match(calls[0]?.args[1] ?? "", /mode=ro/u);
    assert.match(calls[0]?.args[1] ?? "", /query_only/u);
    assert.match(calls[0]?.args[1] ?? "", /ts >= \?/u);
    assert.ok(Number.isFinite(calls[0]?.options.timeout));
    assert.ok(Number.isFinite(calls[0]?.options.maxBuffer));
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("redacts nested incident fields before a restart report leaves the builder", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-report-"));
  const flightRecorderDir = path.join(root, "flight-recorder");
  const codexDir = path.join(root, "codex");
  const workflowLogDir = path.join(root, "workflow");
  mkdirSync(flightRecorderDir, { recursive: true });
  mkdirSync(codexDir, { recursive: true });
  mkdirSync(workflowLogDir, { recursive: true });
  writeFileSync(
    path.join(flightRecorderDir, "incidents.jsonl"),
    `${JSON.stringify({
      observedAt: "2026-07-12T00:00:00.000Z",
      classification: "container-replaced",
      confidence: "high",
      severity: "warning",
      message: "token=fixture-incident-token",
      evidence: [{ detail: "password=fixture-evidence-password" }],
      lastEvent: { detail: "authorization: Bearer fixture-event-token" },
    })}\n`,
  );

  try {
    const report = buildReport({
      around: null,
      codexDir,
      flightRecorderDir,
      since: new Date("2026-07-11T00:00:00.000Z"),
      windowMs: 15 * 60 * 1000,
      workflowLogDir,
    });
    assert.equal(report.incidentCount, 1);
    assert.doesNotMatch(
      JSON.stringify(report),
      /fixture-incident-token|fixture-evidence-password|fixture-event-token/,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("incomplete evidence is explicit and never rendered as proven absence", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-incomplete-"));
  const flightRecorderDir = path.join(root, "flight-recorder");
  const codexDir = path.join(root, "codex");
  const sessionsDir = path.join(codexDir, "sessions", "fixture");
  const workflowLogDir = path.join(root, "workflow");
  mkdirSync(flightRecorderDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(workflowLogDir, { recursive: true });
  writeFileSync(
    path.join(flightRecorderDir, "incidents.jsonl"),
    `not-json\n${JSON.stringify({
      observedAt: "2026-07-15T00:00:00.000Z",
      classification: "same-container-supervisor-abrupt",
      confidence: "high",
      severity: "warning",
      message: "restart",
    })}\n`,
  );
  writeFileSync(
    path.join(sessionsDir, "rollout-fixture.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "exec",
        input: "tools.exec_command(dynamicCommand)",
      },
    })}\n`,
  );

  try {
    const report = buildReport({
      around: null,
      codexDir,
      flightRecorderDir,
      since: new Date("2026-07-14T23:00:00.000Z"),
      windowMs: 15 * 60 * 1000,
      workflowLogDir,
      nowMs: Date.parse("2026-07-15T01:00:00.000Z"),
    });
    assert.equal(report.incidentCount, 1);
    assert.equal(report.evidenceCompleteness.complete, false);
    assert.ok(
      report.evidenceCompleteness.warnings.some((warning) =>
        /malformed JSONL/i.test(warning),
      ),
    );
    assert.ok(
      report.evidenceCompleteness.warnings.some((warning) =>
        /unparsed exec invocation/i.test(warning),
      ),
    );
    assert.equal(
      report.incidents[0]?.attribution.nearbyRiskActivityStatus,
      "unknown",
    );
    assert.equal(
      report.incidents[0]?.attribution.nearbyRiskActivityAvailable,
      null,
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("reports absence only for matching risk activity, not all agent activity", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-risk-semantics-"));
  const flightRecorderDir = path.join(root, "flight-recorder");
  const codexDir = path.join(root, "codex");
  const sessionsDir = path.join(codexDir, "sessions", "fixture");
  const workflowLogDir = path.join(root, "workflow");
  mkdirSync(flightRecorderDir, { recursive: true });
  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(workflowLogDir, { recursive: true });
  writeFileSync(
    path.join(flightRecorderDir, "incidents.jsonl"),
    `${JSON.stringify({
      observedAt: "2026-07-15T00:00:00.000Z",
      classification: "same-container-supervisor-abrupt",
      confidence: "high",
      severity: "warning",
      message: "restart",
    })}\n`,
  );
  writeFileSync(
    path.join(sessionsDir, "rollout-fixture.jsonl"),
    `${JSON.stringify({
      timestamp: "2026-07-15T00:00:00.000Z",
      type: "response_item",
      payload: {
        type: "function_call",
        name: "exec_command",
        arguments: JSON.stringify({ cmd: "echo benign-fixture" }),
      },
    })}\n`,
  );

  try {
    const report = buildReport({
      around: null,
      codexDir,
      flightRecorderDir,
      since: new Date("2026-07-14T23:00:00.000Z"),
      windowMs: 15 * 60 * 1000,
      workflowLogDir,
      nowMs: Date.parse("2026-07-15T01:00:00.000Z"),
    });
    const incident = report.incidents[0];
    assert.equal(report.evidenceCompleteness.complete, true);
    assert.equal(
      incident?.attribution.nearbyRiskActivityStatus,
      "no_matching_risk_activity",
    );
    assert.equal(incident?.attribution.nearbyRiskActivityAvailable, false);
    assert.deepEqual(incident?.nearbyRiskActivity, []);
    assert.equal("nearbyAgentActivityStatus" in incident.attribution, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("zero-incident workflow discovery stays inside the selected range", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-workflow-range-"));
  const flightRecorderDir = path.join(root, "flight-recorder");
  const codexDir = path.join(root, "codex");
  const workflowLogDir = path.join(root, "workflow");
  const workflowPath = path.join(workflowLogDir, "old.shell.exec.0");
  mkdirSync(flightRecorderDir, { recursive: true });
  mkdirSync(path.join(codexDir, "sessions"), { recursive: true });
  mkdirSync(workflowLogDir, { recursive: true });
  writeFileSync(path.join(flightRecorderDir, "incidents.jsonl"), "");
  writeFileSync(workflowPath, "old workflow output\n");
  utimesSync(
    workflowPath,
    new Date("2020-01-01T00:00:00.000Z"),
    new Date("2020-01-01T00:00:00.000Z"),
  );

  try {
    const report = buildReport({
      around: null,
      codexDir,
      flightRecorderDir,
      since: new Date("2026-07-14T00:00:00.000Z"),
      windowMs: 15 * 60 * 1000,
      workflowLogDir,
      nowMs: Date.parse("2026-07-15T01:00:00.000Z"),
    });
    assert.equal(report.incidentCount, 0);
    assert.deepEqual(report.workflowLogs, []);
    assert.equal(report.evidenceCompleteness.complete, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("orders workflow logs chronologically so the text tail keeps the newest", () => {
  const root = mkdtempSync(path.join(tmpdir(), "restart-workflow-order-"));
  const flightRecorderDir = path.join(root, "flight-recorder");
  const codexDir = path.join(root, "codex");
  const workflowLogDir = path.join(root, "workflow");
  mkdirSync(flightRecorderDir, { recursive: true });
  mkdirSync(path.join(codexDir, "sessions"), { recursive: true });
  mkdirSync(workflowLogDir, { recursive: true });
  writeFileSync(path.join(flightRecorderDir, "incidents.jsonl"), "");
  const expectedMtimes = Array.from({ length: 9 }, (_, index) => {
    const mtime = new Date(
      Date.parse("2026-07-15T00:00:00.000Z") + index * 60_000,
    );
    const filePath = path.join(workflowLogDir, `${index}.shell.exec.0`);
    writeFileSync(filePath, `${index}\n`);
    utimesSync(filePath, mtime, mtime);
    return mtime.toISOString();
  });

  try {
    const report = buildReport({
      around: null,
      codexDir,
      flightRecorderDir,
      since: new Date("2026-07-14T23:59:00.000Z"),
      windowMs: 15 * 60 * 1000,
      workflowLogDir,
      nowMs: Date.parse("2026-07-15T01:00:00.000Z"),
    });
    assert.deepEqual(
      report.workflowLogs.map((entry) => entry.mtime),
      expectedMtimes,
    );
    assert.deepEqual(
      report.workflowLogs.slice(-8).map((entry) => entry.mtime),
      expectedMtimes.slice(-8),
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
