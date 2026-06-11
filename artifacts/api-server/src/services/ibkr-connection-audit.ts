import { readdirSync, rmSync } from "node:fs";
import path from "node:path";

import {
  appendFlightRecorderJsonLine,
  atomicWriteFlightRecorderJson,
  atomicWriteFlightRecorderText,
  flightRecorderDateKey,
  recorderDir,
} from "./runtime-flight-recorder";

/**
 * Auditable IBKR connection report.
 *
 * Every connection lifecycle event (from the Pyrus backend, the Windows helper, and the
 * browser) is funneled here, correlated into a per-attempt timeline keyed by activationId,
 * and projected to three running documents under the flight-recorder dir:
 *   - ibkr-connection-YYYY-MM-DD.jsonl   append-only, full-detail event log
 *   - ibkr-connection-current.json       rolling snapshot (live state + current/last attempt + history)
 *   - ibkr-connection-audit.md           human-readable rolling document
 *
 * Goal: an engineer can read one document and see exactly which actor / phase / step failed,
 * with what error, without any live probing. All record paths are best-effort and never throw.
 */

export type ConnectionAuditActor =
  | "pyrus"
  | "helper"
  | "gateway"
  | "ibkr"
  | "cloudflare"
  | "browser"
  | "system";

export type ConnectionAuditEventInput = {
  /** activationId; when null the event attaches to the active/last attempt (or "ambient"). */
  attemptId?: string | null;
  actor: ConnectionAuditActor;
  phase?: string | null;
  step?: string | null;
  status?: string | null;
  message?: string | null;
  fields?: Record<string, unknown> | null;
  error?: { code?: string | null; message?: string | null } | null;
  /** epoch ms; defaults to now. Tests pass this for determinism. */
  at?: number;
};

type ConnectionAuditEvent = {
  seq: number;
  ts: string;
  attemptId: string;
  actor: ConnectionAuditActor;
  phase: string | null;
  step: string | null;
  status: string | null;
  message: string | null;
  fields: Record<string, unknown> | null;
  error: { code: string | null; message: string | null } | null;
  elapsedSinceAttemptStartMs: number;
  elapsedSincePrevMs: number;
};

type AttemptOutcome = "in_progress" | "connected" | "failed" | "canceled";

type ConnectionAttempt = {
  attemptId: string;
  startedAt: string;
  startedAtMs: number;
  updatedAt: string;
  endedAt: string | null;
  outcome: AttemptOutcome;
  lastPhase: string | null;
  stalledAtPhase: string | null;
  lastError: { code: string | null; message: string | null } | null;
  events: ConnectionAuditEvent[];
};

const MAX_ATTEMPTS = 20;
const MAX_EVENTS_PER_ATTEMPT = 500;
const RETENTION_DAYS = 7;
const AMBIENT_ATTEMPT_ID = "ambient";

let seqCounter = 0;
const attempts: ConnectionAttempt[] = []; // oldest first, newest last
let activeAttemptId: string | null = null;
let liveState: {
  connected: boolean | null;
  streamState: string | null;
  desktopAgentOnline: boolean | null;
  helperVersion: string | null;
  updatedAt: string | null;
} = {
  connected: null,
  streamState: null,
  desktopAgentOnline: null,
  helperVersion: null,
  updatedAt: null,
};

function parseHelperVersionRank(
  helperVersion: string | null | undefined,
): { date: string; version: number } | null {
  const match = String(helperVersion || "").match(
    /^(\d{4}-\d{2}-\d{2})\.ib-async-sidecar-v(\d+)\b/,
  );
  if (!match) {
    return null;
  }
  return {
    date: match[1] || "",
    version: Number.parseInt(match[2] || "0", 10),
  };
}

function shouldReplaceLiveHelperVersion(
  previous: string | null,
  next: string | null | undefined,
): next is string {
  if (!next) {
    return false;
  }
  if (!previous || previous === next) {
    return true;
  }
  const previousRank = parseHelperVersionRank(previous);
  const nextRank = parseHelperVersionRank(next);
  if (!previousRank || !nextRank) {
    return true;
  }
  if (nextRank.date !== previousRank.date) {
    return nextRank.date > previousRank.date;
  }
  return nextRank.version >= previousRank.version;
}

function logFilePath(iso: string): string {
  return path.join(recorderDir(), `ibkr-connection-${flightRecorderDateKey(iso)}.jsonl`);
}

function snapshotFilePath(): string {
  return path.join(recorderDir(), "ibkr-connection-current.json");
}

function markdownFilePath(): string {
  return path.join(recorderDir(), "ibkr-connection-audit.md");
}

function findAttempt(attemptId: string): ConnectionAttempt | undefined {
  return attempts.find((attempt) => attempt.attemptId === attemptId);
}

function resolveAttemptId(input: ConnectionAuditEventInput): {
  attemptId: string;
  activationScoped: boolean;
} {
  if (input.attemptId) {
    return { attemptId: input.attemptId, activationScoped: true };
  }
  if (activeAttemptId && findAttempt(activeAttemptId)?.outcome === "in_progress") {
    return { attemptId: activeAttemptId, activationScoped: false };
  }
  const latest = attempts[attempts.length - 1];
  if (latest) {
    return { attemptId: latest.attemptId, activationScoped: false };
  }
  return { attemptId: AMBIENT_ATTEMPT_ID, activationScoped: false };
}

function getOrCreateAttempt(
  attemptId: string,
  atMs: number,
  activationScoped: boolean,
): ConnectionAttempt {
  const existing = findAttempt(attemptId);
  if (existing) {
    return existing;
  }
  const iso = new Date(atMs).toISOString();
  // A brand-new activation supersedes any attempt still in flight: mark it stalled/failed.
  if (activationScoped) {
    for (const attempt of attempts) {
      if (attempt.outcome === "in_progress") {
        attempt.outcome = "failed";
        attempt.stalledAtPhase = attempt.lastPhase;
        attempt.endedAt = iso;
      }
    }
  }
  const attempt: ConnectionAttempt = {
    attemptId,
    startedAt: iso,
    startedAtMs: atMs,
    updatedAt: iso,
    endedAt: null,
    outcome: "in_progress",
    lastPhase: null,
    stalledAtPhase: null,
    lastError: null,
    events: [],
  };
  attempts.push(attempt);
  while (attempts.length > MAX_ATTEMPTS) {
    attempts.shift();
  }
  pruneOldLogs(atMs);
  return attempt;
}

function classifyTerminal(
  event: ConnectionAuditEvent,
): Exclude<AttemptOutcome, "in_progress"> | null {
  const status = (event.status ?? "").toLowerCase();
  const step = (event.step ?? "").toLowerCase();
  if (status === "connected" || step === "connected") {
    return "connected";
  }
  if (status === "canceled" || step.includes("cancel") || step === "superseded") {
    return "canceled";
  }
  return null;
}

export function recordConnectionAuditEvent(input: ConnectionAuditEventInput): void {
  try {
    const atMs = input.at ?? Date.now();
    const { attemptId, activationScoped } = resolveAttemptId(input);
    const attempt = getOrCreateAttempt(attemptId, atMs, activationScoped);
    const prev = attempt.events[attempt.events.length - 1] ?? null;
    const ts = new Date(atMs).toISOString();
    const event: ConnectionAuditEvent = {
      seq: (seqCounter += 1),
      ts,
      attemptId,
      actor: input.actor,
      phase: input.phase ?? null,
      step: input.step ?? null,
      status: input.status ?? null,
      message: input.message ?? null,
      fields: input.fields ?? null,
      error: input.error
        ? { code: input.error.code ?? null, message: input.error.message ?? null }
        : null,
      elapsedSinceAttemptStartMs: Math.max(0, atMs - attempt.startedAtMs),
      elapsedSincePrevMs: prev ? Math.max(0, atMs - Date.parse(prev.ts)) : 0,
    };
    attempt.events.push(event);
    if (attempt.events.length > MAX_EVENTS_PER_ATTEMPT) {
      attempt.events.shift();
    }
    attempt.updatedAt = ts;
    if (event.phase) {
      attempt.lastPhase = event.phase;
    }
    if (event.error) {
      attempt.lastError = event.error;
    }

    const terminal = classifyTerminal(event);
    // Only an event that explicitly names its attempt may terminally close it.
    // Ambient/system signals (e.g. a change-gated connection_state_change from a
    // background bridge-health read, attemptId:null) are still recorded on the
    // active attempt's timeline for context, but must never close it — otherwise
    // a stale "connected" health flip during a mid-handshake activation would
    // prematurely mark that attempt connected and drop the active attempt.
    if (terminal && activationScoped) {
      attempt.outcome = terminal;
      attempt.endedAt = ts;
      if (activeAttemptId === attemptId) {
        activeAttemptId = null;
      }
    } else if (activationScoped) {
      activeAttemptId = attemptId;
      if (attempt.outcome !== "connected") {
        attempt.outcome = "in_progress";
      }
    }

    writeOutputs(event);
  } catch {
    // best-effort: the audit must never break the connection flow.
  }
}

/**
 * Change-gated live connection state. Callers (bridge health resolution) may call this on every
 * read; an audit event is only emitted when `connected` flips or streamState crosses the offline
 * boundary, so steady-state reads do not spam the log.
 */
export function recordConnectionLiveState(next: {
  connected?: boolean | null;
  streamState?: string | null;
  desktopAgentOnline?: boolean | null;
  helperVersion?: string | null;
}): void {
  try {
    const prev = { ...liveState };
    const connected = next.connected ?? prev.connected;
    const streamState = next.streamState ?? prev.streamState;
    liveState = {
      connected,
      streamState,
      desktopAgentOnline: next.desktopAgentOnline ?? prev.desktopAgentOnline,
      helperVersion: shouldReplaceLiveHelperVersion(
        prev.helperVersion,
        next.helperVersion,
      )
        ? next.helperVersion
        : prev.helperVersion,
      updatedAt: new Date().toISOString(),
    };
    const offlineLike = (value: string | null) =>
      value === "offline" || value === "login_required" || value === null;
    const connectedChanged = prev.connected !== connected;
    const offlineBoundaryCrossed = offlineLike(prev.streamState) !== offlineLike(streamState);
    const hadPriorObservation = prev.connected !== null || prev.streamState !== null;
    if (hadPriorObservation && (connectedChanged || offlineBoundaryCrossed)) {
      recordConnectionAuditEvent({
        attemptId: null,
        actor: "system",
        step: "connection_state_change",
        status: connected ? "connected" : "disconnected",
        message: `connected ${prev.connected}→${connected}; streamState ${prev.streamState}→${streamState}`,
        fields: {
          connectedFrom: prev.connected,
          connectedTo: connected,
          streamStateFrom: prev.streamState,
          streamStateTo: streamState,
        },
      });
    }
  } catch {
    // best-effort
  }
}

function summarizeAttempt(attempt: ConnectionAttempt) {
  const endMs = attempt.endedAt ? Date.parse(attempt.endedAt) : Date.now();
  return {
    attemptId: attempt.attemptId,
    startedAt: attempt.startedAt,
    endedAt: attempt.endedAt,
    durationMs: Math.max(0, endMs - attempt.startedAtMs),
    outcome: attempt.outcome,
    lastPhase: attempt.lastPhase,
    stalledAtPhase: attempt.stalledAtPhase,
    lastError: attempt.lastError,
    eventCount: attempt.events.length,
  };
}

export function getConnectionAuditSnapshot() {
  const current =
    (activeAttemptId ? findAttempt(activeAttemptId) : null) ??
    attempts[attempts.length - 1] ??
    null;
  return {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    liveState,
    activeAttemptId,
    current: current
      ? { ...summarizeAttempt(current), events: current.events }
      : null,
    recentAttempts: attempts
      .slice()
      .reverse()
      .map(summarizeAttempt),
  };
}

function renderConnectionAuditMarkdown(
  snapshot: ReturnType<typeof getConnectionAuditSnapshot>,
): string {
  const lines: string[] = [];
  lines.push("# IBKR Connection Audit");
  lines.push("");
  lines.push(`- Updated: \`${snapshot.updatedAt}\``);
  lines.push(
    `- Live: connected=\`${snapshot.liveState.connected}\` streamState=\`${snapshot.liveState.streamState}\` ` +
      `desktopAgentOnline=\`${snapshot.liveState.desktopAgentOnline}\` helper=\`${snapshot.liveState.helperVersion}\``,
  );
  lines.push(`- Active attempt: \`${snapshot.activeAttemptId ?? "none"}\``);
  lines.push("");

  if (snapshot.current) {
    const c = snapshot.current;
    lines.push("## Current / last attempt");
    lines.push("");
    lines.push(
      `- \`${c.attemptId}\` outcome=**${c.outcome}** duration=${Math.round(c.durationMs / 100) / 10}s ` +
        `lastPhase=\`${c.lastPhase ?? "-"}\`` +
        (c.stalledAtPhase ? ` stalledAt=\`${c.stalledAtPhase}\`` : "") +
        (c.lastError ? ` lastError=\`${c.lastError.code ?? c.lastError.message}\`` : ""),
    );
    lines.push("");
    lines.push("| +ms | actor | phase | step | status | message | error |");
    lines.push("|----:|-------|-------|------|--------|---------|-------|");
    for (const ev of c.events) {
      const msg = (ev.message ?? "").replace(/\|/g, "\\|").slice(0, 80);
      const err = ev.error ? (ev.error.code ?? ev.error.message ?? "") : "";
      lines.push(
        `| ${ev.elapsedSinceAttemptStartMs} | ${ev.actor} | ${ev.phase ?? "-"} | ${ev.step ?? "-"} | ${ev.status ?? "-"} | ${msg} | ${err} |`,
      );
    }
    lines.push("");
  }

  if (snapshot.recentAttempts.length > 1) {
    lines.push("## Recent attempts");
    lines.push("");
    lines.push("| attemptId | outcome | duration | lastPhase | stalledAt | lastError |");
    lines.push("|-----------|---------|----------|-----------|-----------|-----------|");
    for (const a of snapshot.recentAttempts) {
      lines.push(
        `| ${a.attemptId} | ${a.outcome} | ${Math.round(a.durationMs / 100) / 10}s | ${a.lastPhase ?? "-"} | ${a.stalledAtPhase ?? "-"} | ${a.lastError ? (a.lastError.code ?? a.lastError.message) : "-"} |`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function writeOutputs(event: ConnectionAuditEvent): void {
  try {
    appendFlightRecorderJsonLine(logFilePath(event.ts), event as Record<string, unknown>);
  } catch {
    // best-effort
  }
  try {
    const snapshot = getConnectionAuditSnapshot();
    atomicWriteFlightRecorderJson(snapshotFilePath(), snapshot);
    atomicWriteFlightRecorderText(
      markdownFilePath(),
      renderConnectionAuditMarkdown(snapshot),
    );
  } catch {
    // best-effort
  }
}

function pruneOldLogs(nowMs: number): void {
  try {
    const cutoffKey = flightRecorderDateKey(
      new Date(nowMs - RETENTION_DAYS * 86_400_000).toISOString(),
    );
    const dir = recorderDir();
    for (const name of readdirSync(dir)) {
      const match = name.match(/^ibkr-connection-(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (match && match[1] < cutoffKey) {
        rmSync(path.join(dir, name), { force: true });
      }
    }
  } catch {
    // best-effort
  }
}

/** Whether a connection attempt is currently in flight (used to gate noisy idle helper polling). */
export function hasActiveConnectionAttempt(): boolean {
  return activeAttemptId !== null;
}

/** Test-only: reset in-memory state. */
export function __resetConnectionAuditForTests(): void {
  seqCounter = 0;
  attempts.length = 0;
  activeAttemptId = null;
  liveState = {
    connected: null,
    streamState: null,
    desktopAgentOnline: null,
    helperVersion: null,
    updatedAt: null,
  };
}
