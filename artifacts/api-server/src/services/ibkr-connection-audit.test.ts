import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const testDir = mkdtempSync(join(tmpdir(), "pyrus-conn-audit-"));
const previousDir = process.env["PYRUS_FLIGHT_RECORDER_DIR"];
process.env["PYRUS_FLIGHT_RECORDER_DIR"] = testDir;

const {
  recordConnectionAuditEvent,
  recordConnectionLiveState,
  getConnectionAuditSnapshot,
  __resetConnectionAuditForTests,
} = await import("./ibkr-connection-audit");

after(() => {
  if (previousDir) {
    process.env["PYRUS_FLIGHT_RECORDER_DIR"] = previousDir;
  } else {
    delete process.env["PYRUS_FLIGHT_RECORDER_DIR"];
  }
  rmSync(testDir, { force: true, recursive: true });
});

test("correlates a full multi-actor connect into one attempt", () => {
  __resetConnectionAuditForTests();
  const t0 = Date.parse("2026-06-09T17:00:00.000Z");
  const activationId = "act-1";
  const seq: Array<[number, string, string, string, string | null]> = [
    [0, "pyrus", "request", "queued_on_pyrus", "starting_bridge"],
    [1000, "helper", "request", "helper_launch_requested", null],
    [3000, "helper", "credentials", "credential_key_published", "waiting_gateway"],
    [3500, "browser", "credentials", "encrypting_credentials", null],
    [4000, "browser", "credentials", "credentials_sent_to_pyrus", null],
    [20000, "gateway", "gateway", "gateway_login_window_active", "waiting_gateway"],
    [30000, "ibkr", "twoFactor", "waiting_2fa", "waiting_gateway"],
    [45000, "helper", "bridge", "gateway_socket_ready", null],
    [60000, "cloudflare", "tunnel", "validating_tunnel", null],
    [75000, "pyrus", "tunnel", "connected", "connected"],
  ];
  for (const [offset, actor, phase, step, status] of seq) {
    recordConnectionAuditEvent({
      attemptId: activationId,
      actor: actor as never,
      phase,
      step,
      status,
      at: t0 + offset,
    });
  }

  const snapshot = getConnectionAuditSnapshot();
  assert.equal(snapshot.recentAttempts.length, 1);
  assert(snapshot.current, "expected a current attempt");
  assert.equal(snapshot.current.attemptId, activationId);
  assert.equal(snapshot.current.outcome, "connected");
  assert.equal(snapshot.current.events.length, 10);
  // ordering + derived durations
  assert.equal(snapshot.current.events[0]?.step, "queued_on_pyrus");
  assert.equal(snapshot.current.events[9]?.step, "connected");
  assert.equal(snapshot.current.events[9]?.elapsedSinceAttemptStartMs, 75000);
  assert.equal(snapshot.current.events[1]?.elapsedSincePrevMs, 1000);
  // all actors captured (the full lifecycle, including browser-only steps)
  const actors = new Set(snapshot.current.events.map((event) => event.actor));
  for (const actor of ["pyrus", "helper", "browser", "gateway", "ibkr", "cloudflare"]) {
    assert(actors.has(actor as never), `missing actor ${actor}`);
  }
  // running documents written
  assert(existsSync(join(testDir, "ibkr-connection-current.json")));
  assert(existsSync(join(testDir, "ibkr-connection-audit.md")));
  assert(
    readdirSync(testDir).some((name) =>
      /^ibkr-connection-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name),
    ),
    "expected a daily jsonl log",
  );
  const markdown = readFileSync(join(testDir, "ibkr-connection-audit.md"), "utf8");
  assert(markdown.includes("encrypting_credentials"));
  assert(markdown.includes("connected"));
});

test("classifies a stalled attempt when a new attempt supersedes it", () => {
  __resetConnectionAuditForTests();
  const t0 = Date.parse("2026-06-09T18:00:00.000Z");
  recordConnectionAuditEvent({
    attemptId: "stall-1",
    actor: "pyrus",
    phase: "request",
    step: "queued_on_pyrus",
    at: t0,
  });
  recordConnectionAuditEvent({
    attemptId: "stall-1",
    actor: "helper",
    phase: "credentials",
    step: "credential_key_published",
    at: t0 + 2000,
  });
  // a brand-new activation supersedes the in-flight one
  recordConnectionAuditEvent({
    attemptId: "stall-2",
    actor: "pyrus",
    phase: "request",
    step: "queued_on_pyrus",
    at: t0 + 5000,
  });

  const snapshot = getConnectionAuditSnapshot();
  const stalled = snapshot.recentAttempts.find((a) => a.attemptId === "stall-1");
  assert(stalled, "expected the stalled attempt to be retained");
  assert.equal(stalled.outcome, "failed");
  assert.equal(stalled.stalledAtPhase, "credentials");
});

test("ambient live-state connect does not terminally close an in-flight attempt", () => {
  __resetConnectionAuditForTests();
  const t0 = Date.parse("2026-06-09T20:00:00.000Z");

  // An activation is mid-handshake (still in the credentials phase).
  recordConnectionAuditEvent({
    attemptId: "act-h3",
    actor: "pyrus",
    phase: "request",
    step: "queued_on_pyrus",
    at: t0,
  });
  recordConnectionAuditEvent({
    attemptId: "act-h3",
    actor: "helper",
    phase: "credentials",
    step: "credential_key_published",
    at: t0 + 2000,
  });

  // A background bridge-health read flips connected -> true (ambient, attemptId:null).
  recordConnectionLiveState({ connected: false, streamState: "offline" }); // prior obs
  recordConnectionLiveState({ connected: true, streamState: "live" }); // flip -> system "connected"

  const midSnapshot = getConnectionAuditSnapshot();
  const midAttempt = midSnapshot.recentAttempts.find(
    (a) => a.attemptId === "act-h3",
  );
  assert(midAttempt, "expected the in-flight attempt to be retained");
  assert.equal(
    midAttempt.outcome,
    "in_progress",
    "an ambient/system connect must not close the attempt",
  );
  assert.equal(
    midSnapshot.activeAttemptId,
    "act-h3",
    "the attempt must remain active after an ambient connect",
  );

  // The real activation-scoped attach still closes it as connected.
  recordConnectionAuditEvent({
    attemptId: "act-h3",
    actor: "pyrus",
    phase: "tunnel",
    step: "bridge_attached",
    status: "connected",
    at: t0 + 5000,
  });
  assert.equal(
    getConnectionAuditSnapshot().recentAttempts.find(
      (a) => a.attemptId === "act-h3",
    )?.outcome,
    "connected",
  );
});

test("live-state recording is change-gated", () => {
  __resetConnectionAuditForTests();
  recordConnectionLiveState({ connected: true, streamState: "live" }); // first obs: no event
  recordConnectionLiveState({ connected: true, streamState: "live" }); // unchanged: no event
  assert.equal(getConnectionAuditSnapshot().recentAttempts.length, 0);

  recordConnectionLiveState({ connected: false, streamState: "offline" }); // transition: event
  const snapshot = getConnectionAuditSnapshot();
  assert.equal(snapshot.recentAttempts.length, 1);
  assert(snapshot.current);
  const transition = snapshot.current.events.find(
    (event) => event.step === "connection_state_change",
  );
  assert(transition, "expected a connection_state_change event");
  assert(transition.fields);
  assert.equal(transition.fields["connectedTo"], false);
});

test("live-state helper version does not downgrade on stale helper polling", () => {
  __resetConnectionAuditForTests();
  recordConnectionLiveState({
    desktopAgentOnline: true,
    helperVersion: "2026-06-09.ib-async-sidecar-v18-agent-converge",
  });
  recordConnectionLiveState({
    desktopAgentOnline: true,
    helperVersion: "2026-06-09.ib-async-sidecar-v15-graceful-deactivate",
  });

  assert.equal(
    getConnectionAuditSnapshot().liveState.helperVersion,
    "2026-06-09.ib-async-sidecar-v18-agent-converge",
  );
});

test("prunes connection log files older than retention", () => {
  __resetConnectionAuditForTests();
  const staleFile = join(testDir, "ibkr-connection-2000-01-01.jsonl");
  writeFileSync(staleFile, "{}\n");
  assert(existsSync(staleFile));
  recordConnectionAuditEvent({
    attemptId: "ret-1",
    actor: "pyrus",
    phase: "request",
    step: "queued_on_pyrus",
    at: Date.parse("2026-06-09T19:00:00.000Z"),
  });
  assert(!existsSync(staleFile), "expected the stale log file to be pruned");
});
