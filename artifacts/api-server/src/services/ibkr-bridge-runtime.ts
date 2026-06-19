import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "../lib/errors";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import { setIbkrBridgeRuntimeAvailabilityProvider } from "../providers/ibkr/bridge-client";
import {
  invalidateBridgeHealthCache,
  primeBridgeHealthForSession,
  setDesktopAgentOnlineProvider,
} from "./platform-bridge-health";
import {
  hasActiveConnectionAttempt,
  recordConnectionAuditEvent,
  recordConnectionLiveState,
  type ConnectionAuditActor,
} from "./ibkr-connection-audit";

// Let platform-bridge-health consult live desktop-agent state without importing
// this module (which would be circular). While an agent is online, a failing
// health circuit must NOT abandon the runtime override / flip the UI to
// disconnected. getIbkrBridgeRuntimeSessionState is a hoisted declaration below.
setDesktopAgentOnlineProvider(
  () => getIbkrBridgeRuntimeSessionState().desktopAgentOnline,
);
setIbkrBridgeRuntimeAvailabilityProvider(() => {
  const runtime = getIbkrBridgeRuntimeSessionState();
  return {
    runtimeOverrideActive: runtime.runtimeOverrideActive,
    desktopAgentOnline: runtime.desktopAgentOnline,
    desktopAgentCompatible: runtime.desktopAgentCompatible,
  };
});

const BRIDGE_VALIDATION_TIMEOUT_MS = 20_000;
const LEGACY_ACTIVATION_TTL_MS = 60 * 60_000;
// A launch that never attaches within this window is marked failed so it does not
// linger as "active" (blocking the UI and activeCount) for the full TTL — e.g. when
// IB Gateway is closed externally during 2FA and the helper keeps polling. A
// successful attach DELETES the activation, so this only ever fails a launch that
// never connected; the window is generous enough to cover slow IBKR 2FA approval.
const HARD_NONTERMINAL_ACTIVATION_MS = 10 * 60_000;
const REMOTE_DESKTOP_STALE_MS = 90_000;
const REMOTE_LAUNCH_JOB_TTL_MS = 10 * 60_000;
// Window during which a helper that already claimed the login envelope may
// re-claim it. Lets a helper instance that claimed but failed to deliver the
// credentials to IB Gateway (a transient typing/socket error and its own retry)
// recover, instead of consuming the one-time handoff on first claim and
// stranding the activation. The envelope stays RSA-encrypted to the helper's
// ephemeral key, so Pyrus cannot read it during this window.
const LEGACY_LOGIN_ENVELOPE_RECLAIM_TTL_MS = 3 * 60_000;
const MAX_LONG_POLL_WAIT_MS = 30_000;
const BRIDGE_HELPER_VERSION =
  "2026-06-13.ib-async-sidecar-v23-responsive-agent-loop";
const KNOWN_BAD_BRIDGE_HELPER_VERSIONS = new Set([
  "2026-06-04.ib-async-sidecar-v6-fast-agent",
]);
const PYRUS_IBKR_PROTOCOL_SCHEME = "pyrus-ibkr";
const LOGIN_HANDOFF_ALGORITHM = "RSA-OAEP-256-CHUNKED";
const REMOTE_DESKTOPS_FILE_ENV_NAMES = [
  "IBKR_BRIDGE_REMOTE_DESKTOPS_FILE",
  "PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE",
];
type IbkrProtocolScheme = typeof PYRUS_IBKR_PROTOCOL_SCHEME;
type IbkrRemoteHelperCompatibility =
  | "compatible"
  | "known_bad"
  | "update_required";

type LauncherResult = {
  activationId: string;
  apiBaseUrl: string;
  autoLoginConfigured: boolean | null;
  autoLoginLaunchUrl: string;
  autoLoginMode: "ib-gateway-live";
  autoLoginSupported: true;
  bridgeToken: string;
  bundleUrl: string | null;
  credentialHandoff: {
    algorithm: typeof LOGIN_HANDOFF_ALGORITHM;
    expiresAt: string;
    mode: "ui-onetime";
  };
  helperUrl: string;
  helperVersion: string;
  launchUrl: string;
  managementToken: string;
  updateOnlyLaunchUrl: string;
};

type IbkrRemoteDesktop = {
  desktopId: string;
  helperHeartbeatAtByVersion: Record<string, number>;
  helperVersion: string | null;
  lastHeartbeatAt: number | null;
  label: string | null;
  lastSeenAt: number;
  registeredAt: number;
  secretHash: string;
};

type IbkrRemoteDesktopRequestDiagnostic = {
  at: string;
  code: string | null;
  contentType?: string | null;
  desktopId: string | null;
  helperVersion: string | null;
  method?: string | null;
  message: string | null;
  ok: boolean;
  path?: string | null;
  route: "register" | "heartbeat" | "claim" | "raw";
  userAgent?: string | null;
};

type IbkrRemoteDesktopSummary = {
  desktopId: string;
  helperCompatibility: IbkrRemoteHelperCompatibility;
  helperCompatible: boolean;
  helperKnownBad: boolean;
  helperUpdateRequired: boolean;
  helperVersion: string | null;
  label: string | null;
  lastSeenAt: string;
  online: boolean;
  registeredAt: string;
};

type IbkrRemoteLaunchJob = {
  action: "launch" | "shutdown";
  activationId: string | null;
  claimedAt: number | null;
  completedAt: number | null;
  completionMessage: string | null;
  completionTokenHash: string | null;
  createdAt: number;
  desktopId: string;
  expiresAt: number;
  failedAt: number | null;
  jobId: string;
  launchUrl: string | null;
  statusTokenHash: string | null;
};

type RemoteLauncherResult = LauncherResult & {
  remoteLaunch: {
    desktop: IbkrRemoteDesktopSummary;
    expiresAt: string;
    jobId: string;
    mode: "desktop-agent";
  };
};

type RemoteShutdownResult = {
  helperVersion: string;
  shutdown: {
    action: "shutdown";
    desktop: IbkrRemoteDesktopSummary;
    expiresAt: string;
    jobId: string;
    mode: "desktop-agent";
    statusToken: string;
  };
};

type RemoteDesktopJobStatusResult = {
  action: "launch" | "shutdown";
  claimedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  expiresAt: string;
  failedAt: string | null;
  jobId: string;
  message: string | null;
  ok: true;
  state: "queued" | "claimed" | "completed" | "failed" | "expired";
};

type RemoteDesktopLaunchJobClaimResult =
  | {
      helperUpdateRequired: boolean;
      helperVersion: string;
      ready: false;
      targetHelperVersion: string;
    }
  | {
      action: "launch";
      activationId: string | null;
      completionToken?: string | null;
      expiresAt: string;
      helperVersion: string;
      jobId: string;
      launchUrl: string;
      ready: true;
      shutdown?: boolean;
    }
  | {
      action: "shutdown";
      completionToken: string | null;
      expiresAt: string;
      helperVersion: string;
      jobId: string;
      launchUrl: string;
      ready: true;
    };

export type IbkrBridgeRuntimeSessionState = {
  runtimeOverrideActive: boolean;
  runtimeOverrideUpdatedAt: Date | null;
  bridgeRuntimeAttached: boolean;
  bridgeRuntimeStatus:
    | "attached"
    | "desktop_agent_online_not_attached"
    | "detached";
  bridgeRuntimeReason:
    | "ibkr_bridge_runtime_unattached"
    | "ibkr_bridge_not_configured"
    | null;
  desktopAgentRegistered: boolean;
  desktopAgentRegisteredCount: number;
  desktopAgentOnline: boolean;
  desktopAgentCompatibility: IbkrRemoteHelperCompatibility | null;
  desktopAgentCompatible: boolean;
  desktopAgentHelperVersion: string | null;
  desktopAgentKnownBad: boolean;
  desktopAgentExpectedHelperVersion: string;
  desktopAgentUpgradeRequired: boolean;
  reconnectAvailable: boolean;
};

type AttachIbkrBridgeRuntimeResult = {
  runtimeOverrideActive: true;
  bridgeUrl: string;
  tokenConfigured: boolean;
  bridge: {
    health: unknown;
    accounts: unknown;
  };
};

type LegacyBridgeActivation = {
  callbackSecret: string;
  bridgeToken: string;
  canceledAt: number | null;
  loginHandoff: LegacyBridgeLoginHandoff | null;
  loginEnvelopeSubmitAttemptCount: number;
  loginEnvelopeClaimedAt: number | null;
  loginEnvelopeHelperInstanceId: string | null;
  loginEnvelopeReceivedAt: number | null;
  loginKeyReadCount: number;
  loginKeyPublishedAt: number | null;
  remoteLaunchJobClaimedAt: number | null;
  remoteLaunchJobCreatedAt: number | null;
  lastLoginEnvelopeSubmitAttemptAt: number | null;
  lastLoginEnvelopeSubmitErrorCode: string | null;
  lastLoginKeyReadAt: number | null;
  lastLoginKeyReadReadyAt: number | null;
  managementToken: string;
  issuedAt: number;
  expiresAt: number;
};

type LegacyBridgeLoginEnvelope = {
  algorithm: typeof LOGIN_HANDOFF_ALGORITHM;
  ciphertextChunks: string[];
  submittedAt: number;
};

type LegacyBridgeLoginHandoff = {
  algorithm: typeof LOGIN_HANDOFF_ALGORITHM;
  helperInstanceId: string;
  publicKeyJwk: unknown;
  createdAt: number;
  envelope: LegacyBridgeLoginEnvelope | null;
};

type LegacyBridgeActivationProgress = {
  activationId: string;
  status: string | null;
  step: string | null;
  message: string | null;
  helperVersion: string | null;
  bridgeUrl: string | null;
  updatedAt: Date;
};

type LegacyBridgeActivationProgressSnapshot = Omit<
  LegacyBridgeActivationProgress,
  "updatedAt"
> & {
  updatedAt: string;
};

type IbkrActivationPhase =
  | "idle"
  | "request"
  | "update"
  | "credentials"
  | "gateway"
  | "twoFactor"
  | "bridge"
  | "tunnel"
  | "complete"
  | "canceled"
  | "error";

type IbkrActivationOwner =
  | "none"
  | "pyrus"
  | "desktopHelper"
  | "ibGateway"
  | "ibkrMobile"
  | "cloudflareTunnel"
  | "user";

type IbkrActivationSeverity =
  | "idle"
  | "progress"
  | "attention"
  | "error"
  | "success";

type IbkrActivationTimelinePhase = Exclude<
  IbkrActivationPhase,
  "idle" | "complete" | "canceled" | "error"
>;

type IbkrActivationPhaseTiming = {
  startedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
};

type IbkrActivationTimelineRow = IbkrActivationPhaseTiming & {
  id: IbkrActivationTimelinePhase;
  label: string;
  owner: IbkrActivationOwner;
  status: "pending" | "active" | "complete" | "attention" | "error" | "canceled";
};

type IbkrActivationInsight = {
  currentPhase: IbkrActivationPhase;
  currentOwner: IbkrActivationOwner;
  currentPhaseStartedAt: string | null;
  currentPhaseElapsedMs: number | null;
  detail: string;
  normalAfterMs: number | null;
  phaseDurations: Record<IbkrActivationTimelinePhase, IbkrActivationPhaseTiming>;
  recommendedAction: string | null;
  severity: IbkrActivationSeverity;
  stale: boolean;
  staleAfterMs: number | null;
  timeline: IbkrActivationTimelineRow[];
  title: string;
};

type LegacyBridgeActivationStatusResult = {
  active: boolean;
  canceled: boolean;
  expiresAt: string;
  insight: IbkrActivationInsight;
  latestProgress: LegacyBridgeActivationProgressSnapshot | null;
  recentProgress: LegacyBridgeActivationProgressSnapshot[];
};

type IbkrBridgeHelperMetadataResult = {
  desktops: IbkrRemoteDesktopSummary[];
  helperVersion: string;
  latestDesktop: IbkrRemoteDesktopSummary | null;
  onlineCount: number;
  onlineDesktop: IbkrRemoteDesktopSummary | null;
  runtime: {
    desktopAgentCompatibility: IbkrRemoteHelperCompatibility | null;
    desktopAgentCompatible: boolean;
    desktopAgentExpectedHelperVersion: string;
    desktopAgentHelperVersion: string | null;
    desktopAgentKnownBad: boolean;
    desktopAgentOnline: boolean;
    desktopAgentRegistered: boolean;
    desktopAgentRegisteredCount: number;
    desktopAgentUpgradeRequired: boolean;
    reconnectAvailable: boolean;
    runtimeOverrideActive: boolean;
    runtimeOverrideUpdatedAt: string | null;
  };
};

type LegacyBridgeLoginKeyReadResult =
  | {
      ready: false;
    }
  | {
      algorithm: typeof LOGIN_HANDOFF_ALGORITHM;
      expiresAt: string;
      helperInstanceId: string;
      publicKeyJwk: unknown;
      ready: true;
    };

type LegacyBridgeLoginEnvelopeClaimResult =
  | {
      ready: false;
      canceled?: boolean;
    }
  | {
      envelope: {
        algorithm: typeof LOGIN_HANDOFF_ALGORITHM;
        ciphertextChunks: string[];
      };
      ready: true;
    };

const legacyBridgeActivations = new Map<string, LegacyBridgeActivation>();
const legacyBridgeActivationProgress = new Map<
  string,
  LegacyBridgeActivationProgress[]
>();
let latestLegacyBridgeActivationId: string | null = null;
const ibkrRemoteDesktops = new Map<string, IbkrRemoteDesktop>();
const ibkrRemoteLaunchJobs = new Map<string, IbkrRemoteLaunchJob>();
let ibkrRemoteDesktopsLoaded = false;
const remoteDesktopJobWaiters = new Map<string, Set<() => void>>();
const legacyLoginKeyWaiters = new Map<string, Set<() => void>>();
const legacyLoginEnvelopeWaiters = new Map<string, Set<() => void>>();
const ibkrRemoteDesktopRequestDiagnostics: IbkrRemoteDesktopRequestDiagnostic[] =
  [];

function readLongPollWaitMs(
  body: unknown,
  maxWaitMs = MAX_LONG_POLL_WAIT_MS,
): number {
  if (!body || typeof body !== "object") {
    return 0;
  }
  const rawWaitMs = (body as Record<string, unknown>).waitMs;
  const waitMs =
    typeof rawWaitMs === "number"
      ? rawWaitMs
      : typeof rawWaitMs === "string"
        ? Number(rawWaitMs)
        : 0;
  if (!Number.isFinite(waitMs) || waitMs <= 0) {
    return 0;
  }
  return Math.min(maxWaitMs, Math.max(0, Math.floor(waitMs)));
}

function waitForNotification(
  waiters: Map<string, Set<() => void>>,
  key: string,
  waitMs: number,
): Promise<void> {
  if (!key || waitMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const resolveOnce = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      const entries = waiters.get(key);
      entries?.delete(resolveOnce);
      if (entries && entries.size === 0) {
        waiters.delete(key);
      }
      resolve();
    };

    const entries = waiters.get(key) ?? new Set<() => void>();
    entries.add(resolveOnce);
    waiters.set(key, entries);
    timeout = setTimeout(resolveOnce, waitMs);
  });
}

function notifyWaiters(
  waiters: Map<string, Set<() => void>>,
  key: string,
): void {
  const entries = waiters.get(key);
  if (!entries) {
    return;
  }
  for (const resolve of Array.from(entries)) {
    resolve();
  }
}

function notifyLegacyActivationWaiters(activationId: string): void {
  notifyWaiters(legacyLoginKeyWaiters, activationId);
  notifyWaiters(legacyLoginEnvelopeWaiters, activationId);
}

function notifyAllWaiters(waiters: Map<string, Set<() => void>>): void {
  for (const key of Array.from(waiters.keys())) {
    notifyWaiters(waiters, key);
  }
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function selectIbkrProtocolSchemeForDesktop(
  _desktop: IbkrRemoteDesktop,
): IbkrProtocolScheme {
  return PYRUS_IBKR_PROTOCOL_SCHEME;
}

function rewriteIbkrProtocolScheme(
  rawUrl: string,
  scheme: IbkrProtocolScheme,
): string {
  const url = new URL(rawUrl);
  return `${scheme}://${url.host}${url.pathname}${url.search}${url.hash}`;
}

function normalizeBaseUrl(rawBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw new HttpError(400, "API base URL is not valid.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "API base URL must use HTTP or HTTPS.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";
  return stripTrailingSlash(url.toString());
}

function normalizeOptionalHttpUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "Bridge URL is not valid.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new HttpError(400, "Bridge URL must use HTTP or HTTPS.", {
      code: "invalid_ibkr_bridge_launcher_url",
    });
  }

  return url.toString();
}

function rewriteIbkrProtocolHelperVersion(
  rawUrl: string,
  helperVersion: string | null,
): string {
  if (!helperVersion || !isIbkrRemoteHelperCompatible(helperVersion)) {
    return rawUrl;
  }

  try {
    const url = new URL(rawUrl);
    url.searchParams.set("helperVersion", helperVersion);
    return url.toString();
  } catch {
    return rawUrl;
  }
}

function rewriteIbkrProtocolLaunchForDesktop(
  rawUrl: string,
  desktop: IbkrRemoteDesktop,
  helperVersion: string | null,
): string {
  const launchUrl = rewriteIbkrProtocolScheme(
    rawUrl,
    selectIbkrProtocolSchemeForDesktop(desktop),
  );
  return rewriteIbkrProtocolHelperVersion(launchUrl, helperVersion);
}

function asString(
  value: unknown,
  fieldName: string,
  maxLength = 512,
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`, {
      code: "invalid_ibkr_bridge_payload",
    });
  }

  return value.trim().slice(0, maxLength);
}

function readOptionalString(value: unknown, maxLength = 512): string | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return value.trim().slice(0, maxLength);
}

function recordIbkrRemoteDesktopRequestDiagnostic(input: {
  body: unknown;
  contentType?: string | null;
  error?: unknown;
  method?: string | null;
  ok: boolean;
  path?: string | null;
  route: IbkrRemoteDesktopRequestDiagnostic["route"];
  userAgent?: string | null;
}): void {
  const payload =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  const error = input.error;
  const code =
    error instanceof HttpError
      ? readOptionalString(error.code, 120)
      : error instanceof Error
        ? error.name || "Error"
        : null;
  const message =
    error instanceof Error ? readOptionalString(error.message, 300) : null;

  ibkrRemoteDesktopRequestDiagnostics.push({
    at: new Date().toISOString(),
    code,
    contentType: input.contentType ?? null,
    desktopId: readOptionalString(payload.desktopId, 160),
    helperVersion: readOptionalString(payload.helperVersion, 120),
    method: input.method ?? null,
    message,
    ok: input.ok,
    path: input.path ?? null,
    route: input.route,
    userAgent: input.userAgent ?? null,
  });
  ibkrRemoteDesktopRequestDiagnostics.splice(
    0,
    Math.max(0, ibkrRemoteDesktopRequestDiagnostics.length - 50),
  );

  const desktopId = readOptionalString(payload.desktopId, 160);
  const helperVersion = readOptionalString(payload.helperVersion, 120);
  recordConnectionLiveState({ desktopAgentOnline: true, helperVersion });
  // Audit helper requests that matter for diagnosis: any failure, or register/claim while a
  // connection attempt is actually in flight (e.g. the helper claiming a launch then going
  // silent). Skip steady idle polling and the duplicate "raw" entries so the log stays readable.
  const meaningfulRoute =
    input.route !== "heartbeat" &&
    input.route !== "raw" &&
    hasActiveConnectionAttempt();
  if (!input.ok || meaningfulRoute) {
    recordConnectionAuditEvent({
      attemptId: null,
      actor: "helper",
      step: `desktop_${input.route}`,
      status: input.ok ? "ok" : "error",
      message,
      fields: { desktopId, helperVersion, path: input.path ?? null, method: input.method ?? null },
      error: input.ok ? null : { code, message },
    });
  }
}

export function recordIbkrRemoteDesktopRouteAttempt(
  route: IbkrRemoteDesktopRequestDiagnostic["route"],
  body: unknown,
  error?: unknown,
): void {
  recordIbkrRemoteDesktopRequestDiagnostic({
    body,
    error,
    ok: !error,
    route,
  });
}

export function recordIbkrRemoteDesktopRawRequestAttempt(input: {
  contentType?: string | null;
  method?: string | null;
  path?: string | null;
  userAgent?: string | null;
}): void {
  recordIbkrRemoteDesktopRequestDiagnostic({
    body: null,
    contentType: input.contentType,
    method: input.method,
    ok: true,
    path: input.path,
    route: "raw",
    userAgent: input.userAgent,
  });
}

function readOptionalTimestamp(value: unknown): number | null {
  const timestamp =
    typeof value === "string" || value instanceof Date
      ? new Date(value).getTime()
      : typeof value === "number"
        ? value
        : Number.NaN;
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readHelperHeartbeatAtByVersion(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const result: Record<string, number> = {};
  for (const [rawVersion, rawTimestamp] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const helperVersion = readOptionalString(rawVersion, 120);
    const timestamp = readOptionalTimestamp(rawTimestamp);
    if (helperVersion && timestamp != null) {
      result[helperVersion] = timestamp;
    }
  }
  return result;
}

function getIbkrRemoteDesktopsFile(): string {
  for (const name of REMOTE_DESKTOPS_FILE_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }

  const repoRoot = process.env["REPL_HOME"]?.trim();
  if (repoRoot) {
    return join(
      repoRoot,
      "artifacts",
      "api-server",
      "data",
      "ibkr-remote-desktops.json",
    );
  }

  return join(process.cwd(), "data", "ibkr-remote-desktops.json");
}

function loadIbkrRemoteDesktops(): void {
  if (ibkrRemoteDesktopsLoaded) {
    return;
  }
  ibkrRemoteDesktopsLoaded = true;

  try {
    const parsed = JSON.parse(readFileSync(getIbkrRemoteDesktopsFile(), "utf8")) as
      | {
          desktops?: unknown;
        }
      | unknown;
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const desktops = (parsed as { desktops?: unknown }).desktops;
    if (!Array.isArray(desktops)) {
      return;
    }

    for (const item of desktops) {
      if (!item || typeof item !== "object") {
        continue;
      }
      const record = item as Record<string, unknown>;
      const desktopId = readOptionalString(record.desktopId, 160);
      const secretHash = readOptionalString(record.secretHash, 160);
      if (!desktopId || !secretHash) {
        continue;
      }

      const registeredAt = readOptionalTimestamp(record.registeredAt) ?? Date.now();
      const lastSeenAt =
        readOptionalTimestamp(record.lastSeenAt) ?? registeredAt;
      const lastHeartbeatAt = readOptionalTimestamp(record.lastHeartbeatAt);
      const helperVersion = readOptionalString(record.helperVersion, 120);
      const helperHeartbeatAtByVersion = readHelperHeartbeatAtByVersion(
        record.helperHeartbeatAtByVersion,
      );
      if (helperVersion && lastHeartbeatAt != null) {
        helperHeartbeatAtByVersion[helperVersion] =
          helperHeartbeatAtByVersion[helperVersion] ?? lastHeartbeatAt;
      }

      ibkrRemoteDesktops.set(desktopId, {
        desktopId,
        helperHeartbeatAtByVersion,
        helperVersion,
        lastHeartbeatAt,
        label: readOptionalString(record.label, 160),
        lastSeenAt,
        registeredAt,
        secretHash,
      });
    }
  } catch {
    return;
  }
}

function persistIbkrRemoteDesktops(): void {
  const path = getIbkrRemoteDesktopsFile();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify(
      {
        version: 1,
        desktops: Array.from(ibkrRemoteDesktops.values()).map((desktop) => ({
          desktopId: desktop.desktopId,
          helperHeartbeatAtByVersion: Object.fromEntries(
            Object.entries(desktop.helperHeartbeatAtByVersion).map(
              ([helperVersion, timestamp]) => [
                helperVersion,
                new Date(timestamp).toISOString(),
              ],
            ),
          ),
          helperVersion: desktop.helperVersion,
          lastHeartbeatAt:
            desktop.lastHeartbeatAt == null
              ? null
              : new Date(desktop.lastHeartbeatAt).toISOString(),
          label: desktop.label,
          lastSeenAt: new Date(desktop.lastSeenAt).toISOString(),
          registeredAt: new Date(desktop.registeredAt).toISOString(),
          secretHash: desktop.secretHash,
        })),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function readStringArray(
  value: unknown,
  fieldName: string,
  maxItems = 16,
  maxItemLength = 1_024,
): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maxItems) {
    throw new HttpError(400, `${fieldName} is invalid.`, {
      code: "invalid_ibkr_bridge_payload",
    });
  }

  return value.map((item) => asString(item, fieldName, maxItemLength));
}

function readJsonObject(value: unknown, fieldName: string): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, `${fieldName} is required.`, {
      code: "invalid_ibkr_bridge_payload",
    });
  }

  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 8_192) {
    throw new HttpError(400, `${fieldName} is too large.`, {
      code: "invalid_ibkr_bridge_payload",
    });
  }

  return value;
}

function hashManagementToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function hashDesktopSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

function hashRemoteJobToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function pruneLegacyBridgeActivations(now = Date.now()): void {
  for (const [activationId, activation] of legacyBridgeActivations) {
    if (activation.expiresAt <= now) {
      legacyBridgeActivations.delete(activationId);
      legacyBridgeActivationProgress.delete(activationId);
      notifyLegacyActivationWaiters(activationId);
      if (latestLegacyBridgeActivationId === activationId) {
        latestLegacyBridgeActivationId = null;
      }
      continue;
    }
    // Fast-fail a launch that never attached within the hard window so it stops
    // counting as active. Successful attaches delete the activation, so a record
    // still present here never connected.
    if (
      !activation.canceledAt &&
      now - activation.issuedAt > HARD_NONTERMINAL_ACTIVATION_MS
    ) {
      activation.canceledAt = now;
      appendLegacyBridgeActivationProgress({
        activationId,
        status: "error",
        step: "error",
        message:
          "IB Gateway launch did not complete in time and was marked failed. Start the launch again.",
      });
      notifyLegacyActivationWaiters(activationId);
    }
  }
}

function pruneIbkrRemoteLaunchJobs(now = Date.now()): void {
  for (const [jobId, job] of ibkrRemoteLaunchJobs) {
    if (job.expiresAt <= now) {
      ibkrRemoteLaunchJobs.delete(jobId);
    }
  }
}

function summarizeIbkrRemoteJobStatus(
  job: IbkrRemoteLaunchJob,
  now = Date.now(),
): RemoteDesktopJobStatusResult {
  const state =
    job.completedAt != null
      ? "completed"
      : job.failedAt != null
        ? "failed"
        : job.expiresAt <= now
          ? "expired"
          : job.claimedAt != null
            ? "claimed"
            : "queued";

  return {
    action: job.action,
    claimedAt: job.claimedAt == null ? null : new Date(job.claimedAt).toISOString(),
    completedAt:
      job.completedAt == null ? null : new Date(job.completedAt).toISOString(),
    createdAt: new Date(job.createdAt).toISOString(),
    expiresAt: new Date(job.expiresAt).toISOString(),
    failedAt: job.failedAt == null ? null : new Date(job.failedAt).toISOString(),
    jobId: job.jobId,
    message: job.completionMessage,
    ok: true,
    state,
  };
}

function isIbkrRemoteHelperHeartbeatOnline(
  timestamp: number | null | undefined,
  now: number,
): timestamp is number {
  return timestamp != null && now - timestamp <= REMOTE_DESKTOP_STALE_MS;
}

function classifyIbkrRemoteHelperVersion(
  helperVersion: string | null | undefined,
): IbkrRemoteHelperCompatibility {
  if (!helperVersion) {
    return "update_required";
  }
  if (KNOWN_BAD_BRIDGE_HELPER_VERSIONS.has(helperVersion)) {
    return "known_bad";
  }
  if (
    helperVersion === BRIDGE_HELPER_VERSION ||
    helperVersion.startsWith(`${BRIDGE_HELPER_VERSION}-`)
  ) {
    return "compatible";
  }
  return "update_required";
}

function isIbkrRemoteHelperCompatible(
  helperVersion: string | null | undefined,
): boolean {
  return classifyIbkrRemoteHelperVersion(helperVersion) === "compatible";
}

function hasOnlineCompatibleIbkrRemoteHelper(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): boolean {
  return Object.entries(desktop.helperHeartbeatAtByVersion).some(
    ([helperVersion, timestamp]) =>
      isIbkrRemoteHelperCompatible(helperVersion) &&
      isIbkrRemoteHelperHeartbeatOnline(timestamp, now),
  );
}

function resolveEffectiveIbkrRemoteHelper(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): { helperVersion: string | null; lastHeartbeatAt: number | null } {
  const onlineHelpers = Object.entries(desktop.helperHeartbeatAtByVersion)
    .filter(([, timestamp]) =>
      isIbkrRemoteHelperHeartbeatOnline(timestamp, now),
    )
    .sort((left, right) => right[1] - left[1]);
  const latestCompatibleHelper = onlineHelpers.find(([helperVersion]) =>
    isIbkrRemoteHelperCompatible(helperVersion),
  );
  if (latestCompatibleHelper) {
    return {
      helperVersion: latestCompatibleHelper[0],
      lastHeartbeatAt: latestCompatibleHelper[1],
    };
  }

  const latestOnlineHelper = onlineHelpers[0];
  if (latestOnlineHelper) {
    return {
      helperVersion: latestOnlineHelper[0],
      lastHeartbeatAt: latestOnlineHelper[1],
    };
  }

  if (
    desktop.helperVersion &&
    isIbkrRemoteHelperHeartbeatOnline(desktop.lastHeartbeatAt, now)
  ) {
    return {
      helperVersion: desktop.helperVersion,
      lastHeartbeatAt: desktop.lastHeartbeatAt,
    };
  }

  return {
    helperVersion: null,
    lastHeartbeatAt: null,
  };
}

function applyEffectiveIbkrRemoteHelper(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): { helperVersion: string | null; lastHeartbeatAt: number | null } {
  const effectiveHelper = resolveEffectiveIbkrRemoteHelper(desktop, now);
  if (effectiveHelper.helperVersion) {
    desktop.helperVersion = effectiveHelper.helperVersion;
  }
  desktop.lastHeartbeatAt = effectiveHelper.lastHeartbeatAt;
  return effectiveHelper;
}

function recordIbkrRemoteHelperHeartbeat(
  desktop: IbkrRemoteDesktop,
  helperVersion: string | null,
  now = Date.now(),
): { helperVersion: string | null; lastHeartbeatAt: number | null } {
  if (helperVersion) {
    desktop.helperHeartbeatAtByVersion[helperVersion] = now;
  }
  desktop.lastSeenAt = now;
  return applyEffectiveIbkrRemoteHelper(desktop, now);
}

function canIbkrRemoteHelperClaimJobs(
  desktop: IbkrRemoteDesktop,
  helperVersion: string | null,
  now = Date.now(),
): boolean {
  if (isIbkrRemoteHelperCompatible(helperVersion)) {
    return true;
  }

  return !hasOnlineCompatibleIbkrRemoteHelper(desktop, now);
}

function selectIbkrDesktopPollingHelperVersion(
  helperVersion: string | null,
): string {
  return helperVersion ?? BRIDGE_HELPER_VERSION;
}

function buildIbkrDesktopHelperVersionHints(helperVersion: string | null): {
  helperUpdateRequired: boolean;
  helperVersion: string;
  targetHelperVersion: string;
} {
  return {
    helperUpdateRequired: !isIbkrRemoteHelperCompatible(helperVersion),
    helperVersion: selectIbkrDesktopPollingHelperVersion(helperVersion),
    targetHelperVersion: BRIDGE_HELPER_VERSION,
  };
}

function summarizeIbkrRemoteDesktop(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): IbkrRemoteDesktopSummary {
  const effectiveHelper = resolveEffectiveIbkrRemoteHelper(desktop, now);
  const helperVersion = effectiveHelper.helperVersion ?? desktop.helperVersion;
  const helperCompatibility = classifyIbkrRemoteHelperVersion(helperVersion);
  return {
    desktopId: desktop.desktopId,
    helperCompatibility,
    helperCompatible: helperCompatibility === "compatible",
    helperKnownBad: helperCompatibility === "known_bad",
    helperUpdateRequired: helperCompatibility !== "compatible",
    helperVersion,
    label: desktop.label,
    lastSeenAt: new Date(
      effectiveHelper.lastHeartbeatAt ?? desktop.lastSeenAt,
    ).toISOString(),
    online: Boolean(effectiveHelper.helperVersion),
    registeredAt: new Date(desktop.registeredAt).toISOString(),
  };
}

function readIbkrRemoteDesktopAuth(body: unknown): {
  desktopId: string;
  desktopSecret: string;
} {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Desktop agent payload is required.", {
      code: "invalid_ibkr_desktop_agent_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  return {
    desktopId: asString(payload.desktopId, "desktopId", 160),
    desktopSecret: asString(payload.desktopSecret, "desktopSecret", 256),
  };
}

function assertIbkrRemoteDesktopAuthenticated(
  body: unknown,
): IbkrRemoteDesktop {
  loadIbkrRemoteDesktops();
  pruneIbkrRemoteLaunchJobs();
  const auth = readIbkrRemoteDesktopAuth(body);
  const desktop = ibkrRemoteDesktops.get(auth.desktopId);
  if (
    !desktop ||
    !safeStringEquals(desktop.secretHash, hashDesktopSecret(auth.desktopSecret))
  ) {
    throw new HttpError(401, "Desktop agent authentication failed.", {
      code: "invalid_ibkr_desktop_agent_secret",
    });
  }

  desktop.lastSeenAt = Date.now();
  return desktop;
}

function selectIbkrRemoteDesktop(
  requestedDesktopId: string | null,
  options: { allowStaleFallback?: boolean } = {},
): IbkrRemoteDesktop {
  loadIbkrRemoteDesktops();
  pruneIbkrRemoteLaunchJobs();
  const now = Date.now();
  const candidates = Array.from(ibkrRemoteDesktops.values())
    .map((desktop) => ({
      desktop,
      effectiveHelper: resolveEffectiveIbkrRemoteHelper(desktop, now),
    }))
    .filter(({ effectiveHelper }) => effectiveHelper.helperVersion)
    .sort(
      (left, right) =>
        (right.effectiveHelper.lastHeartbeatAt ?? 0) -
        (left.effectiveHelper.lastHeartbeatAt ?? 0),
    )
    .map(({ desktop }) => desktop);

  if (requestedDesktopId) {
    const desktop = candidates.find(
      (candidate) => candidate.desktopId === requestedDesktopId,
    );
    if (desktop) {
      return desktop;
    }
    if (options.allowStaleFallback) {
      const staleDesktop = ibkrRemoteDesktops.get(requestedDesktopId);
      if (staleDesktop) {
        return staleDesktop;
      }
    }
  } else if (candidates[0]) {
    return candidates[0];
  } else if (options.allowStaleFallback) {
    const staleDesktop = Array.from(ibkrRemoteDesktops.values()).sort(
      (left, right) => right.lastSeenAt - left.lastSeenAt,
    )[0];
    if (staleDesktop) {
      return staleDesktop;
    }
  }

  throw new HttpError(
    409,
    "No paired Windows desktop agent is online. Run the IBKR launcher once from the Windows computer, then retry from mobile.",
    {
      code: "ibkr_remote_desktop_unavailable",
    },
  );
}

function isIbkrRemoteLaunchJobCurrent(job: IbkrRemoteLaunchJob): boolean {
  if (job.action === "shutdown") {
    return true;
  }
  if (!job.activationId) {
    return false;
  }
  const activation = legacyBridgeActivations.get(job.activationId);
  if (!activation || activation.canceledAt) {
    return false;
  }

  try {
    assertLegacyBridgeActivationIsCurrent(job.activationId, activation);
    return true;
  } catch {
    return false;
  }
}

function assertLegacyBridgeActivationIsCurrent(
  activationId: string,
  activation: LegacyBridgeActivation,
  options: { allowCanceled?: boolean } = {},
): void {
  if (
    latestLegacyBridgeActivationId &&
    latestLegacyBridgeActivationId !== activationId
  ) {
    throw new HttpError(
      409,
      "IB Gateway bridge activation was superseded by a newer launch.",
      {
        code: "ibkr_bridge_activation_superseded",
      },
    );
  }

  if (activation.canceledAt && !options.allowCanceled) {
    throw new HttpError(
      409,
      "IB Gateway bridge activation was canceled.",
      {
        code: "ibkr_bridge_activation_canceled",
      },
    );
  }

  const currentOverride = getIbkrBridgeRuntimeOverride();
  if (
    currentOverride &&
    currentOverride.updatedAt.getTime() >= activation.issuedAt
  ) {
    throw new HttpError(
      409,
      "IB Gateway bridge activation was superseded by a newer launch.",
      {
        code: "ibkr_bridge_activation_superseded",
      },
    );
  }
}

function createLegacyBridgeActivation(input: {
  bridgeToken: string;
  managementToken: string;
}): {
  activationId: string;
  callbackSecret: string;
} {
  pruneLegacyBridgeActivations();
  const now = Date.now();
  for (const [existingActivationId, activation] of legacyBridgeActivations) {
    if (!activation.canceledAt) {
      activation.canceledAt = now;
      const events = legacyBridgeActivationProgress.get(existingActivationId) ?? [];
      events.push({
        activationId: existingActivationId,
        status: "canceled",
        step: "superseded",
        message: "IB Gateway bridge launch was superseded by a newer launch.",
        helperVersion: BRIDGE_HELPER_VERSION,
        bridgeUrl: null,
        updatedAt: new Date(now),
      });
      legacyBridgeActivationProgress.set(existingActivationId, events.slice(-20));
      notifyLegacyActivationWaiters(existingActivationId);
    }
  }
  const activationId = randomBytes(16).toString("hex");
  const callbackSecret = randomBytes(32).toString("hex");
  legacyBridgeActivations.set(activationId, {
    callbackSecret,
    bridgeToken: input.bridgeToken,
    canceledAt: null,
    loginHandoff: null,
    loginEnvelopeSubmitAttemptCount: 0,
    loginEnvelopeClaimedAt: null,
    loginEnvelopeHelperInstanceId: null,
    loginEnvelopeReceivedAt: null,
    loginKeyReadCount: 0,
    loginKeyPublishedAt: null,
    remoteLaunchJobClaimedAt: null,
    remoteLaunchJobCreatedAt: null,
    lastLoginEnvelopeSubmitAttemptAt: null,
    lastLoginEnvelopeSubmitErrorCode: null,
    lastLoginKeyReadAt: null,
    lastLoginKeyReadReadyAt: null,
    managementToken: input.managementToken,
    issuedAt: now,
    expiresAt: now + LEGACY_ACTIVATION_TTL_MS,
  });
  legacyBridgeActivationProgress.set(activationId, []);
  latestLegacyBridgeActivationId = activationId;
  notifyLegacyActivationWaiters(activationId);

  return {
    activationId,
    callbackSecret,
  };
}

function readLegacyBridgeActivation(
  activationId: string,
  body: unknown,
  options: { allowCanceled?: boolean } = {},
): LegacyBridgeActivation {
  pruneLegacyBridgeActivations();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge activation callback payload is required.", {
      code: "invalid_ibkr_bridge_activation_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const callbackSecret = asString(payload.callbackSecret, "callbackSecret", 160);
  const activation = legacyBridgeActivations.get(activationId);
  if (!activation) {
    throw new HttpError(404, "IB Gateway bridge activation is no longer active.", {
      code: "ibkr_bridge_activation_not_found",
    });
  }
  if (!safeStringEquals(activation.callbackSecret, callbackSecret)) {
    throw new HttpError(401, "IB Gateway bridge activation secret is invalid.", {
      code: "invalid_ibkr_bridge_activation_secret",
    });
  }
  assertLegacyBridgeActivationIsCurrent(activationId, activation, options);

  return activation;
}

function readLegacyBridgeActivationByManagementToken(
  activationId: string,
  body: unknown,
  options: { allowCanceled?: boolean } = {},
): LegacyBridgeActivation {
  pruneLegacyBridgeActivations();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge activation management payload is required.", {
      code: "invalid_ibkr_bridge_activation_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const managementToken = asString(payload.managementToken, "managementToken", 160);
  const activation = legacyBridgeActivations.get(activationId);
  if (!activation) {
    throw new HttpError(404, "IB Gateway bridge activation is no longer active.", {
      code: "ibkr_bridge_activation_not_found",
    });
  }
  if (!safeStringEquals(activation.managementToken, managementToken)) {
    throw new HttpError(401, "IB Gateway bridge management token is invalid.", {
      code: "invalid_ibkr_bridge_management_token",
    });
  }
  assertLegacyBridgeActivationIsCurrent(activationId, activation, options);

  return activation;
}

const AUDIT_PHASE_ACTOR: Record<string, ConnectionAuditActor> = {
  request: "pyrus",
  update: "helper",
  credentials: "pyrus",
  gateway: "gateway",
  twoFactor: "ibkr",
  bridge: "helper",
  tunnel: "cloudflare",
};

function auditActivationProgress(
  activationId: string,
  status: string,
  step: string,
  message: string,
  helperVersion?: string | null,
): void {
  const phase = IBKR_ACTIVATION_STEP_PHASE[step] ?? null;
  const actor = (phase ? AUDIT_PHASE_ACTOR[phase] : null) ?? "pyrus";
  recordConnectionAuditEvent({
    attemptId: activationId,
    actor,
    phase,
    step,
    status,
    message,
    fields: helperVersion ? { helperVersion } : null,
  });
}

function appendLegacyBridgeActivationProgress(input: {
  activationId: string;
  bridgeUrl?: string | null;
  helperVersion?: string | null;
  message: string;
  status: string;
  step: string;
}): void {
  const events = legacyBridgeActivationProgress.get(input.activationId) ?? [];
  events.push({
    activationId: input.activationId,
    status: input.status,
    step: input.step,
    message: input.message,
    helperVersion: input.helperVersion ?? BRIDGE_HELPER_VERSION,
    bridgeUrl: input.bridgeUrl ?? null,
    updatedAt: new Date(),
  });
  legacyBridgeActivationProgress.set(input.activationId, events.slice(-20));
  auditActivationProgress(
    input.activationId,
    input.status,
    input.step,
    input.message,
    input.helperVersion,
  );
}

function normalizeBridgeUrl(rawBridgeUrl: string): string {
  let url: URL;

  try {
    url = new URL(rawBridgeUrl);
  } catch {
    throw new HttpError(400, "Bridge URL is not a valid URL.", {
      code: "invalid_ibkr_bridge_url",
    });
  }

  if (url.protocol !== "https:") {
    throw new HttpError(400, "Bridge URL must use HTTPS.", {
      code: "invalid_ibkr_bridge_url",
    });
  }

  if (url.pathname && url.pathname !== "/") {
    throw new HttpError(400, "Bridge URL must be the bridge origin, not a nested API path.", {
      code: "invalid_ibkr_bridge_url",
      detail: "Use the tunnel root URL without /v1/api.",
    });
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return stripTrailingSlash(url.toString());
}

function truncateDetail(value: string): string {
  return value.length <= 240 ? value : `${value.slice(0, 240)}...`;
}

async function fetchBridgeJson<T>(
  baseUrl: string,
  path: string,
  apiToken: string | null,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    BRIDGE_VALIDATION_TIMEOUT_MS,
  );

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      headers: apiToken
        ? {
            Accept: "application/json",
            Authorization: `Bearer ${apiToken}`,
          }
        : {
            Accept: "application/json",
          },
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;

    if (text) {
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const detail =
        typeof payload === "string"
          ? truncateDetail(payload)
          : payload && typeof payload === "object"
            ? truncateDetail(JSON.stringify(payload))
            : undefined;
      throw new HttpError(400, "Bridge validation failed.", {
        code: "ibkr_bridge_validation_failed",
        detail,
      });
    }

    return payload as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }

    throw new HttpError(502, "Bridge validation request failed.", {
      code: "ibkr_bridge_validation_request_failed",
      cause: error,
      detail:
        error instanceof Error && error.message
          ? error.message
          : "The bridge could not be reached.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function assertBridgeHealth(health: unknown): void {
  if (!health || typeof health !== "object") {
    throw new HttpError(400, "Bridge health response was invalid.", {
      code: "ibkr_bridge_validation_failed",
    });
  }

  const record = health as Record<string, unknown>;
  if (record.competing === true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is competing with another API client.",
      {
        code: "ibkr_bridge_competing",
        detail:
          typeof record.lastError === "string" && record.lastError.trim()
            ? record.lastError
            : "The local launcher should retry with a different TWS client ID.",
      },
    );
  }

  if (record.connected !== true || record.authenticated !== true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is reachable but not connected.",
      {
        code: "ibkr_bridge_not_connected",
        detail:
          typeof record.lastError === "string" && record.lastError.trim()
            ? record.lastError
            : "Open and log in to IB Gateway, then run the bridge launcher again.",
      },
    );
  }

  const accounts = Array.isArray(record.accounts) ? record.accounts : [];
  if (accounts.length === 0 && record.accountsLoaded !== true) {
    throw new HttpError(
      400,
      "IB Gateway bridge is connected but no managed accounts are loaded.",
      {
        code: "ibkr_bridge_accounts_unavailable",
        detail:
          "Wait for IB Gateway account data to finish loading, then run the bridge launcher again.",
      },
    );
  }

  const marketDataMode =
    typeof record.marketDataMode === "string"
      ? record.marketDataMode.toLowerCase()
      : null;
  const configuredLiveMarketDataMode =
    record.configuredLiveMarketDataMode === true ||
    marketDataMode === "live" ||
    (marketDataMode === null && record.liveMarketDataAvailable === true);
  if (!configuredLiveMarketDataMode || record.liveMarketDataAvailable === false) {
    throw new HttpError(
      400,
      "IB Gateway bridge is connected but live market data mode is not active.",
      {
        code: "ibkr_bridge_live_data_not_active",
        detail:
          "PYRUS expects IB Gateway live mode on API port 4001 with market data type 1.",
      },
    );
  }
}

function buildProtocolLaunchUrl(input: {
  activationId: string;
  apiBaseUrl: string;
  autoLogin?: boolean;
  bridgeToken: string;
  bundleUrl: string | null;
  callbackSecret: string;
  desktopAgentLaunch?: boolean;
  helperUrl: string;
  helperUpdateOnly?: boolean;
  managementToken: string;
  scheme?: IbkrProtocolScheme;
}): string {
  const params = new URLSearchParams({
    activationId: input.activationId,
    apiBaseUrl: input.apiBaseUrl,
    bridgeToken: input.bridgeToken,
    callbackSecret: input.callbackSecret,
    managementToken: input.managementToken,
    helperUrl: input.helperUrl,
    helperVersion: BRIDGE_HELPER_VERSION,
  });

  if (input.autoLogin) {
    params.set("autoLogin", "1");
    params.set("autoLoginMode", "ib-gateway-live");
    params.set("loginMode", "ui-onetime");
  }
  if (input.helperUpdateOnly) {
    params.set("helperUpdateOnly", "1");
  }
  if (input.desktopAgentLaunch) {
    params.set("desktopAgentLaunch", "1");
  }

  if (input.bundleUrl) {
    params.set("bundleUrl", input.bundleUrl);
    params.set("requiredCapability", "bridgeBundle");
  }

  const repoUrl = process.env["IBKR_BRIDGE_REPO_URL"]?.trim();
  if (repoUrl) {
    params.set("repoUrl", repoUrl);
  }

  const branch = process.env["IBKR_BRIDGE_REPO_BRANCH"]?.trim();
  if (branch) {
    params.set("branch", branch);
  }

  return `${input.scheme ?? PYRUS_IBKR_PROTOCOL_SCHEME}://launch?${params.toString()}`;
}

function buildProtocolShutdownUrl(input: {
  apiBaseUrl: string;
  completionToken: string;
  helperUrl: string;
  jobId: string;
  scheme?: IbkrProtocolScheme;
}): string {
  const params = new URLSearchParams({
    apiBaseUrl: input.apiBaseUrl,
    completionToken: input.completionToken,
    helperUrl: input.helperUrl,
    helperVersion: BRIDGE_HELPER_VERSION,
    jobId: input.jobId,
    shutdown: "1",
  });

  return `${input.scheme ?? PYRUS_IBKR_PROTOCOL_SCHEME}://launch?${params.toString()}`;
}

function readProtocolUrlParam(rawUrl: string | null, name: string): string | null {
  if (!rawUrl) {
    return null;
  }

  try {
    return new URL(rawUrl).searchParams.get(name);
  } catch {
    return null;
  }
}

function createIbkrBridgeLauncher(input: {
  apiBaseUrl: string;
  bundleUrl?: string | null;
  desktopAgentLaunch?: boolean;
  scheme?: IbkrProtocolScheme;
}): LauncherResult {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const helperUrl = `${apiBaseUrl}/api/ibkr/bridge/helper.ps1`;
  const bundleUrl =
    input.bundleUrl === undefined
      ? `${apiBaseUrl}/api/ibkr/bridge/bundle.tar.gz`
      : input.bundleUrl
        ? normalizeOptionalHttpUrl(input.bundleUrl)
        : null;
  const bridgeToken = randomBytes(32).toString("hex");
  const managementToken = randomBytes(32).toString("hex");
  const legacyActivation = createLegacyBridgeActivation({
    bridgeToken,
    managementToken,
  });

  return {
    activationId: legacyActivation.activationId,
    apiBaseUrl,
    autoLoginConfigured: null,
    autoLoginLaunchUrl: buildProtocolLaunchUrl({
      activationId: legacyActivation.activationId,
      apiBaseUrl,
      autoLogin: true,
      bridgeToken,
      bundleUrl,
      callbackSecret: legacyActivation.callbackSecret,
      desktopAgentLaunch: input.desktopAgentLaunch,
      helperUrl,
      managementToken,
      scheme: input.scheme,
    }),
    autoLoginMode: "ib-gateway-live",
    autoLoginSupported: true,
    bridgeToken,
    bundleUrl,
    credentialHandoff: {
      algorithm: LOGIN_HANDOFF_ALGORITHM,
      expiresAt: new Date(Date.now() + LEGACY_ACTIVATION_TTL_MS).toISOString(),
      mode: "ui-onetime",
    },
    helperUrl,
    helperVersion: BRIDGE_HELPER_VERSION,
    launchUrl: buildProtocolLaunchUrl({
      activationId: legacyActivation.activationId,
      apiBaseUrl,
      bridgeToken,
      bundleUrl,
      callbackSecret: legacyActivation.callbackSecret,
      desktopAgentLaunch: input.desktopAgentLaunch,
      helperUrl,
      managementToken,
      scheme: input.scheme,
    }),
    managementToken,
    updateOnlyLaunchUrl: buildProtocolLaunchUrl({
      activationId: legacyActivation.activationId,
      apiBaseUrl,
      bridgeToken,
      bundleUrl,
      callbackSecret: legacyActivation.callbackSecret,
      desktopAgentLaunch: input.desktopAgentLaunch,
      helperUrl,
      helperUpdateOnly: true,
      managementToken,
      scheme: input.scheme,
    }),
  };
}

export function getIbkrBridgeLauncher(input: {
  apiBaseUrl: string;
  bundleUrl?: string | null;
}): LauncherResult {
  return createIbkrBridgeLauncher(input);
}

export function listIbkrRemoteDesktops(): {
  desktops: IbkrRemoteDesktopSummary[];
  helperVersion: string;
  onlineCount: number;
} {
  loadIbkrRemoteDesktops();
  pruneIbkrRemoteLaunchJobs();
  const now = Date.now();
  const desktops = Array.from(ibkrRemoteDesktops.values())
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)
    .map((desktop) => summarizeIbkrRemoteDesktop(desktop, now));

  return {
    desktops,
    helperVersion: BRIDGE_HELPER_VERSION,
    onlineCount: desktops.filter((desktop) => desktop.online).length,
  };
}

export function getIbkrBridgeRuntimeSessionState(): IbkrBridgeRuntimeSessionState {
  const runtimeOverride = getIbkrBridgeRuntimeOverride();
  const remoteDesktops = listIbkrRemoteDesktops();
  const desktopAgentRegisteredCount = remoteDesktops.desktops.length;
  const onlineDesktop =
    remoteDesktops.desktops.find((desktop) => desktop.online) ?? null;
  const latestDesktop = remoteDesktops.desktops[0] ?? null;
  const statusDesktop = onlineDesktop ?? latestDesktop;
  const desktopAgentHelperVersion = statusDesktop?.helperVersion ?? null;
  const desktopAgentCompatibility = statusDesktop
    ? statusDesktop.helperCompatibility
    : null;
  const desktopAgentCompatible =
    desktopAgentCompatibility === "compatible";
  const desktopAgentKnownBad = desktopAgentCompatibility === "known_bad";
  const desktopAgentUpgradeRequired = Boolean(
    statusDesktop && !desktopAgentCompatible,
  );
  const bridgeRuntimeAttached = Boolean(runtimeOverride);
  const bridgeRuntimeStatus = bridgeRuntimeAttached
    ? "attached"
    : onlineDesktop
      ? "desktop_agent_online_not_attached"
      : "detached";

  return {
    runtimeOverrideActive: bridgeRuntimeAttached,
    runtimeOverrideUpdatedAt: runtimeOverride?.updatedAt ?? null,
    bridgeRuntimeAttached,
    bridgeRuntimeStatus,
    bridgeRuntimeReason: bridgeRuntimeAttached
      ? null
      : onlineDesktop
        ? "ibkr_bridge_runtime_unattached"
        : "ibkr_bridge_not_configured",
    desktopAgentRegistered: desktopAgentRegisteredCount > 0,
    desktopAgentRegisteredCount,
    desktopAgentOnline: Boolean(onlineDesktop),
    desktopAgentCompatibility,
    desktopAgentCompatible,
    desktopAgentHelperVersion,
    desktopAgentKnownBad,
    desktopAgentExpectedHelperVersion: BRIDGE_HELPER_VERSION,
    desktopAgentUpgradeRequired,
    reconnectAvailable: Boolean(
      !runtimeOverride &&
        onlineDesktop &&
        desktopAgentCompatible,
    ),
  };
}

export function getIbkrBridgeHelperMetadata(): IbkrBridgeHelperMetadataResult {
  const remoteDesktops = listIbkrRemoteDesktops();
  const runtime = getIbkrBridgeRuntimeSessionState();
  const onlineDesktop =
    remoteDesktops.desktops.find((desktop) => desktop.online) ?? null;

  return {
    desktops: remoteDesktops.desktops,
    helperVersion: remoteDesktops.helperVersion,
    latestDesktop: remoteDesktops.desktops[0] ?? null,
    onlineCount: remoteDesktops.onlineCount,
    onlineDesktop,
    runtime: {
      ...runtime,
      runtimeOverrideUpdatedAt:
        runtime.runtimeOverrideUpdatedAt == null
          ? null
          : runtime.runtimeOverrideUpdatedAt.toISOString(),
    },
  };
}

export function registerIbkrRemoteDesktop(body: unknown): {
  desktop: IbkrRemoteDesktopSummary;
  helperUpdateRequired: boolean;
  helperVersion: string;
  ok: true;
  targetHelperVersion: string;
} {
  loadIbkrRemoteDesktops();
  pruneIbkrRemoteLaunchJobs();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Desktop agent registration payload is required.", {
      code: "invalid_ibkr_desktop_agent_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const desktopId = asString(payload.desktopId, "desktopId", 160);
  const desktopSecret = asString(payload.desktopSecret, "desktopSecret", 256);
  if (desktopSecret.length < 24) {
    throw new HttpError(400, "Desktop agent secret is too short.", {
      code: "invalid_ibkr_desktop_agent_secret",
    });
  }

  const existing = ibkrRemoteDesktops.get(desktopId);
  if (
    existing &&
    !safeStringEquals(existing.secretHash, hashDesktopSecret(desktopSecret))
  ) {
    throw new HttpError(401, "Desktop agent authentication failed.", {
      code: "invalid_ibkr_desktop_agent_secret",
    });
  }

  if (!existing) {
    const activationId = readOptionalString(payload.activationId, 160);
    const callbackSecret = readOptionalString(payload.callbackSecret, 160);
    if (!activationId || !callbackSecret) {
      throw new HttpError(
        401,
        "New desktop agents must be paired by a live Windows launcher activation.",
        {
          code: "ibkr_desktop_agent_pairing_required",
        },
      );
    }
    readLegacyBridgeActivation(
      activationId,
      { callbackSecret },
      { allowCanceled: true },
    );
  }

  const now = Date.now();
  const helperVersion = readOptionalString(payload.helperVersion, 120);
  const desktop: IbkrRemoteDesktop = {
    desktopId,
    helperHeartbeatAtByVersion: existing?.helperHeartbeatAtByVersion ?? {},
    helperVersion,
    lastHeartbeatAt: existing?.lastHeartbeatAt ?? null,
    label: readOptionalString(payload.label, 160),
    lastSeenAt: now,
    registeredAt: existing?.registeredAt ?? now,
    secretHash: hashDesktopSecret(desktopSecret),
  };
  const effectiveHelper = applyEffectiveIbkrRemoteHelper(desktop, now);
  if (!effectiveHelper.helperVersion && helperVersion) {
    desktop.helperVersion = helperVersion;
  }
  ibkrRemoteDesktops.set(desktopId, desktop);
  if (
    !existing ||
    existing.helperVersion !== desktop.helperVersion ||
    existing.label !== desktop.label ||
    existing.secretHash !== desktop.secretHash
  ) {
    persistIbkrRemoteDesktops();
  }

  return {
    desktop: summarizeIbkrRemoteDesktop(desktop, now),
    ...buildIbkrDesktopHelperVersionHints(helperVersion),
    ok: true,
  };
}

export function heartbeatIbkrRemoteDesktop(body: unknown): {
  desktop: IbkrRemoteDesktopSummary;
  helperUpdateRequired: boolean;
  helperVersion: string;
  ok: true;
  pendingJobCount: number;
  targetHelperVersion: string;
} {
  const desktop = assertIbkrRemoteDesktopAuthenticated(body);
  const payload = body as Record<string, unknown>;
  const helperVersion =
    readOptionalString(payload.helperVersion, 120) ?? desktop.helperVersion;
  desktop.label = readOptionalString(payload.label, 160) ?? desktop.label;
  const now = Date.now();
  recordIbkrRemoteHelperHeartbeat(desktop, helperVersion, now);
  persistIbkrRemoteDesktops();
  const canClaimJobs = canIbkrRemoteHelperClaimJobs(desktop, helperVersion, now);
  const pendingJobCount = Array.from(ibkrRemoteLaunchJobs.values()).filter(
    (job) =>
      canClaimJobs &&
      job.desktopId === desktop.desktopId &&
      !job.claimedAt &&
      job.expiresAt > now &&
      isIbkrRemoteLaunchJobCurrent(job),
  ).length;

  return {
    desktop: summarizeIbkrRemoteDesktop(desktop, now),
    ...buildIbkrDesktopHelperVersionHints(helperVersion),
    ok: true,
    pendingJobCount,
  };
}

export function claimIbkrRemoteDesktopLaunchJob(
  body: unknown,
): RemoteDesktopLaunchJobClaimResult {
  const desktop = assertIbkrRemoteDesktopAuthenticated(body);
  const payload = body as Record<string, unknown>;
  const helperVersion =
    readOptionalString(payload.helperVersion, 120) ?? desktop.helperVersion;
  desktop.label = readOptionalString(payload.label, 160) ?? desktop.label;
  const now = Date.now();
  recordIbkrRemoteHelperHeartbeat(desktop, helperVersion, now);
  persistIbkrRemoteDesktops();
  const canClaimLaunchJobs = canIbkrRemoteHelperClaimJobs(
    desktop,
    helperVersion,
    now,
  );
  const jobs = Array.from(ibkrRemoteLaunchJobs.values())
    .filter((job) => job.desktopId === desktop.desktopId && !job.claimedAt)
    .sort((left, right) => left.createdAt - right.createdAt);

  for (const job of jobs) {
    if (job.expiresAt <= now || !isIbkrRemoteLaunchJobCurrent(job)) {
      ibkrRemoteLaunchJobs.delete(job.jobId);
      continue;
    }
    if (job.action === "shutdown") {
      if (!job.launchUrl) {
        ibkrRemoteLaunchJobs.delete(job.jobId);
        continue;
      }
      job.claimedAt = now;
      const launchUrl = rewriteIbkrProtocolLaunchForDesktop(
        job.launchUrl,
        desktop,
        helperVersion,
      );
      if (isIbkrRemoteHelperCompatible(helperVersion)) {
        return {
          action: "shutdown",
          completionToken: readProtocolUrlParam(launchUrl, "completionToken"),
          expiresAt: new Date(job.expiresAt).toISOString(),
          helperVersion: BRIDGE_HELPER_VERSION,
          jobId: job.jobId,
          launchUrl,
          ready: true,
        };
      }

      return {
        action: "launch",
        activationId: null,
        completionToken: readProtocolUrlParam(launchUrl, "completionToken"),
        expiresAt: new Date(job.expiresAt).toISOString(),
        helperVersion: BRIDGE_HELPER_VERSION,
        jobId: job.jobId,
        launchUrl,
        ready: true,
        shutdown: true,
      };
    }

    if (!canClaimLaunchJobs) {
      continue;
    }

    if (!job.activationId || !job.launchUrl) {
      ibkrRemoteLaunchJobs.delete(job.jobId);
      continue;
    }

    job.claimedAt = now;
    const activation = legacyBridgeActivations.get(job.activationId);
    if (activation) {
      activation.remoteLaunchJobClaimedAt = activation.remoteLaunchJobClaimedAt ?? now;
      appendLegacyBridgeActivationProgress({
        activationId: job.activationId,
        status: "starting_bridge",
        step: "helper_launch_requested",
        message:
          "Windows desktop agent claimed the IBKR launch request and is opening the helper.",
      });
    }
    const launchUrl = rewriteIbkrProtocolLaunchForDesktop(
      job.launchUrl,
      desktop,
      helperVersion,
    );

    return {
      action: "launch",
      activationId: job.activationId,
      expiresAt: new Date(job.expiresAt).toISOString(),
      helperVersion: BRIDGE_HELPER_VERSION,
      jobId: job.jobId,
      launchUrl,
      ready: true,
    };
  }

  return {
    ...buildIbkrDesktopHelperVersionHints(helperVersion),
    ready: false,
  };
}

export async function claimIbkrRemoteDesktopLaunchJobWithWait(
  body: unknown,
): Promise<RemoteDesktopLaunchJobClaimResult> {
  const initial = claimIbkrRemoteDesktopLaunchJob(body);
  const waitMs = readLongPollWaitMs(body);
  if (
    initial.ready ||
    initial.helperUpdateRequired ||
    waitMs <= 0 ||
    !body ||
    typeof body !== "object"
  ) {
    return initial;
  }

  const desktopId = readOptionalString(
    (body as Record<string, unknown>).desktopId,
    160,
  );
  if (!desktopId) {
    return initial;
  }

  await waitForNotification(remoteDesktopJobWaiters, desktopId, waitMs);
  return claimIbkrRemoteDesktopLaunchJob(body);
}

export function createIbkrRemoteBridgeLaunch(input: {
  apiBaseUrl: string;
  body?: unknown;
  bundleUrl?: string | null;
}): RemoteLauncherResult {
  const payload =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  const useAutoLogin = payload.autoLogin === true;
  const useHelperUpdateOnly = payload.helperUpdateOnly === true && !useAutoLogin;
  const desktop = selectIbkrRemoteDesktop(
    readOptionalString(payload.desktopId, 160),
    { allowStaleFallback: true },
  );
  const launcher = createIbkrBridgeLauncher({
    apiBaseUrl: input.apiBaseUrl,
    bundleUrl: input.bundleUrl,
    desktopAgentLaunch: true,
    scheme: selectIbkrProtocolSchemeForDesktop(desktop),
  });
  const now = Date.now();
  for (const [jobId, job] of ibkrRemoteLaunchJobs) {
    if (job.desktopId === desktop.desktopId && !job.claimedAt) {
      ibkrRemoteLaunchJobs.delete(jobId);
    }
  }

  const jobId = randomBytes(16).toString("hex");
  const job: IbkrRemoteLaunchJob = {
    action: "launch",
    activationId: launcher.activationId,
    claimedAt: null,
    completedAt: null,
    completionMessage: null,
    completionTokenHash: null,
    createdAt: now,
    desktopId: desktop.desktopId,
    expiresAt: now + REMOTE_LAUNCH_JOB_TTL_MS,
    failedAt: null,
    jobId,
    launchUrl: useAutoLogin
      ? launcher.autoLoginLaunchUrl
      : useHelperUpdateOnly
        ? launcher.updateOnlyLaunchUrl
        : launcher.launchUrl,
    statusTokenHash: null,
  };
  ibkrRemoteLaunchJobs.set(jobId, job);
  const activation = legacyBridgeActivations.get(launcher.activationId);
  if (activation) {
    activation.remoteLaunchJobCreatedAt = now;
    appendLegacyBridgeActivationProgress({
      activationId: launcher.activationId,
      status: "starting_bridge",
      step: "queued_on_pyrus",
      message: "IBKR launch request queued in Pyrus for the Windows desktop.",
    });
  }
  notifyWaiters(remoteDesktopJobWaiters, desktop.desktopId);

  return {
    ...launcher,
    remoteLaunch: {
      desktop: summarizeIbkrRemoteDesktop(desktop, now),
      expiresAt: new Date(job.expiresAt).toISOString(),
      jobId,
      mode: "desktop-agent",
    },
  };
}

export function createIbkrRemoteBridgeShutdown(input: {
  apiBaseUrl: string;
  body?: unknown;
}): RemoteShutdownResult {
  const apiBaseUrl = normalizeBaseUrl(input.apiBaseUrl);
  const payload =
    input.body && typeof input.body === "object"
      ? (input.body as Record<string, unknown>)
      : {};
  const managementToken = readOptionalString(payload.managementToken, 160);
  const force = payload.force === true;
  const currentOverride = getIbkrBridgeRuntimeOverride();
  if (currentOverride?.managementTokenHash) {
    if (
      !managementToken ||
      !safeStringEquals(
        currentOverride.managementTokenHash,
        hashManagementToken(managementToken),
      )
    ) {
      if (!force) {
        throw new HttpError(401, "IB Gateway shutdown token is invalid.", {
          code: "invalid_ibkr_bridge_shutdown_token",
        });
      }
    }
  } else if (!force && !managementToken) {
    throw new HttpError(400, "IB Gateway shutdown requires a management token.", {
      code: "invalid_ibkr_bridge_shutdown_payload",
    });
  }

  const desktop = selectIbkrRemoteDesktop(
    readOptionalString(payload.desktopId, 160),
  );
  const helperUrl = `${apiBaseUrl}/api/ibkr/bridge/helper.ps1`;

  const now = Date.now();
  for (const [jobId, job] of ibkrRemoteLaunchJobs) {
    if (job.desktopId === desktop.desktopId && !job.claimedAt) {
      ibkrRemoteLaunchJobs.delete(jobId);
    }
  }

  const jobId = randomBytes(16).toString("hex");
  const completionToken = randomBytes(32).toString("hex");
  const statusToken = randomBytes(32).toString("hex");
  const shutdownLaunchUrl = buildProtocolShutdownUrl({
    apiBaseUrl,
    completionToken,
    helperUrl,
    jobId,
    scheme: selectIbkrProtocolSchemeForDesktop(desktop),
  });
  const job: IbkrRemoteLaunchJob = {
    action: "shutdown",
    activationId: null,
    claimedAt: null,
    completedAt: null,
    completionMessage: null,
    completionTokenHash: hashRemoteJobToken(completionToken),
    createdAt: now,
    desktopId: desktop.desktopId,
    expiresAt: now + REMOTE_LAUNCH_JOB_TTL_MS,
    failedAt: null,
    jobId,
    launchUrl: shutdownLaunchUrl,
    statusTokenHash: hashRemoteJobToken(statusToken),
  };
  ibkrRemoteLaunchJobs.set(jobId, job);
  notifyWaiters(remoteDesktopJobWaiters, desktop.desktopId);
  // A shutdown is a user-initiated teardown: drop the cached bridge health so
  // status stops serving a stale "connected" snapshot (operational health is
  // otherwise fresh for up to ~120s on the diagnostics path) while the helper
  // tears the bridge down asynchronously. Mirrors the detach path.
  invalidateBridgeHealthCache();
  recordConnectionAuditEvent({
    attemptId: null,
    actor: "pyrus",
    step: "shutdown_requested",
    status: "shutdown",
    message:
      "IBKR shutdown job queued for the Windows desktop; bridge-health cache invalidated.",
    fields: { jobId, desktopId: desktop.desktopId, force },
  });

  return {
    helperVersion: BRIDGE_HELPER_VERSION,
    shutdown: {
      action: "shutdown",
      desktop: summarizeIbkrRemoteDesktop(desktop, now),
      expiresAt: new Date(job.expiresAt).toISOString(),
      jobId,
      mode: "desktop-agent",
      statusToken,
    },
  };
}

export function readIbkrRemoteDesktopJobStatus(
  body: unknown,
): RemoteDesktopJobStatusResult {
  pruneIbkrRemoteLaunchJobs();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Desktop job status payload is required.", {
      code: "invalid_ibkr_desktop_job_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const jobId = asString(payload.jobId, "jobId", 160);
  const statusToken = asString(payload.statusToken, "statusToken", 160);
  const job = ibkrRemoteLaunchJobs.get(jobId);
  if (!job || !job.statusTokenHash) {
    throw new HttpError(404, "Desktop job was not found.", {
      code: "ibkr_desktop_job_not_found",
    });
  }
  if (!safeStringEquals(job.statusTokenHash, hashRemoteJobToken(statusToken))) {
    throw new HttpError(401, "Desktop job status token is invalid.", {
      code: "invalid_ibkr_desktop_job_status_token",
    });
  }

  return summarizeIbkrRemoteJobStatus(job);
}

export function completeIbkrRemoteDesktopJob(
  body: unknown,
): RemoteDesktopJobStatusResult {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Desktop job completion payload is required.", {
      code: "invalid_ibkr_desktop_job_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const jobId = asString(payload.jobId, "jobId", 160);
  const completionToken = asString(payload.completionToken, "completionToken", 160);
  const job = ibkrRemoteLaunchJobs.get(jobId);
  if (!job || !job.completionTokenHash) {
    throw new HttpError(404, "Desktop job was not found.", {
      code: "ibkr_desktop_job_not_found",
    });
  }
  if (
    !safeStringEquals(
      job.completionTokenHash,
      hashRemoteJobToken(completionToken),
    )
  ) {
    throw new HttpError(401, "Desktop job completion token is invalid.", {
      code: "invalid_ibkr_desktop_job_completion_token",
    });
  }

  const now = Date.now();
  const ok = payload.ok !== false;
  const message =
    readOptionalString(payload.message, 1_000) ??
    (ok ? "Desktop job completed." : "Desktop job failed.");
  job.completionMessage = message;
  if (ok) {
    job.completedAt = job.completedAt ?? now;
    job.failedAt = null;
  } else {
    job.failedAt = job.failedAt ?? now;
  }

  return summarizeIbkrRemoteJobStatus(job, now);
}

export function recordLegacyIbkrBridgeActivationProgress(
  activationId: string,
  body: unknown,
): { ok: true } {
  const activation = readLegacyBridgeActivation(activationId, body, {
    allowCanceled: true,
  });
  if (activation.canceledAt) {
    throw new HttpError(409, "IB Gateway bridge activation was canceled.", {
      code: "ibkr_bridge_activation_canceled",
    });
  }

  const payload = body as Record<string, unknown>;
  const events = legacyBridgeActivationProgress.get(activationId) ?? [];
  events.push({
    activationId,
    status: readOptionalString(payload.status, 80),
    step: readOptionalString(payload.step, 120),
    message: readOptionalString(payload.message, 1_000),
    helperVersion: readOptionalString(payload.helperVersion, 120),
    bridgeUrl: readOptionalString(payload.bridgeUrl, 256),
    updatedAt: new Date(),
  });
  legacyBridgeActivationProgress.set(activationId, events.slice(-20));

  return {
    ok: true,
  };
}

function serializeLegacyBridgeActivationProgress(
  event: LegacyBridgeActivationProgress,
): LegacyBridgeActivationProgressSnapshot {
  return {
    ...event,
    updatedAt: event.updatedAt.toISOString(),
  };
}

const IBKR_ACTIVATION_TIMELINE_PHASES: Array<{
  id: IbkrActivationTimelinePhase;
  label: string;
  owner: IbkrActivationOwner;
}> = [
  { id: "request", label: "Request", owner: "pyrus" },
  { id: "update", label: "Update", owner: "desktopHelper" },
  { id: "credentials", label: "Credentials", owner: "pyrus" },
  { id: "gateway", label: "Gateway", owner: "ibGateway" },
  { id: "twoFactor", label: "2FA", owner: "ibkrMobile" },
  { id: "bridge", label: "Bridge", owner: "desktopHelper" },
  { id: "tunnel", label: "Tunnel", owner: "cloudflareTunnel" },
];

const IBKR_ACTIVATION_PHASE_INDEX = new Map(
  IBKR_ACTIVATION_TIMELINE_PHASES.map((phase, index) => [phase.id, index]),
);

const IBKR_ACTIVATION_STALE_AFTER_MS: Record<
  IbkrActivationTimelinePhase,
  number | null
> = {
  request: 8_000,
  update: 20_000,
  credentials: 12_000,
  gateway: 25_000,
  twoFactor: 30_000,
  bridge: 30_000,
  tunnel: 45_000,
};

const IBKR_ACTIVATION_NORMAL_AFTER_MS: Record<
  IbkrActivationTimelinePhase,
  number | null
> = {
  request: 2_000,
  update: 8_000,
  credentials: 5_000,
  gateway: 10_000,
  twoFactor: 15_000,
  bridge: 10_000,
  tunnel: 15_000,
};

const IBKR_ACTIVATION_PHASE_DETAIL: Record<
  IbkrActivationTimelinePhase,
  { action: string | null; detail: string; title: string }
> = {
  request: {
    action: null,
    detail: "Pyrus sent the launch request and is waiting for the desktop helper.",
    title: "Waiting on Windows helper",
  },
  update: {
    action: "Let the desktop helper finish updating, then keep this popover open.",
    detail: "The Windows helper is updating before it can continue the IBKR launch.",
    title: "Updating Windows helper",
  },
  credentials: {
    action: "Keep this popover open while Pyrus hands encrypted credentials to the helper.",
    detail: "Pyrus is preparing or delivering the one-time encrypted IBKR credentials.",
    title: "Waiting for encrypted credentials",
  },
  gateway: {
    action: "If IB Gateway shows a prompt, clear it on the Windows desktop.",
    detail: "The Windows desktop is opening IB Gateway and preparing the login window.",
    title: "Waiting for IB Gateway",
  },
  twoFactor: {
    action: "Approve the IBKR Mobile prompt or clear any Gateway prompt on Windows.",
    detail: "Credentials were submitted and IBKR is waiting for mobile or 2FA approval.",
    title: "Waiting for IBKR Mobile approval",
  },
  bridge: {
    action: null,
    detail: "The local bridge is starting and connecting to the Gateway API socket.",
    title: "Starting bridge",
  },
  tunnel: {
    action: "If this stays slow, retry the connection after the current attempt settles.",
    detail: "The bridge is ready and the public tunnel is being validated.",
    title: "Waiting for tunnel",
  },
};

const IBKR_ACTIVATION_STEP_PHASE: Record<string, IbkrActivationTimelinePhase> = {
  autologin_preflight: "credentials",
  bridge_bundle_fallback: "bridge",
  bridge_bundle_ready: "bridge",
  bridge_reused: "bridge",
  bridge_restart_for_bundle: "bridge",
  bridge_unhealthy: "bridge",
  building_bridge: "bridge",
  checking_gateway_socket: "request",
  cloning_repo: "bridge",
  credential_key_published: "credentials",
  credential_key_read: "credentials",
  credentials_delivered: "credentials",
  credentials_received: "credentials",
  credentials_sent_to_pyrus: "credentials",
  credentials_submitted: "twoFactor",
  downloading_bridge_bundle: "bridge",
  encrypting_credentials: "credentials",
  gateway_foreground_fallback: "gateway",
  gateway_login_window_active: "gateway",
  gateway_login_window_unconfirmed: "gateway",
  gateway_login_window_wait: "gateway",
  gateway_login_window_waiting: "gateway",
  gateway_process_started: "gateway",
  gateway_ready: "gateway",
  gateway_reconnect_required: "bridge",
  gateway_running_waiting_login: "gateway",
  gateway_running_waiting_socket: "gateway",
  gateway_socket_ready: "bridge",
  gateway_window_login: "gateway",
  helper_launched: "request",
  helper_launch_requested: "request",
  helper_updated: "update",
  installing_dependencies: "bridge",
  launching_gateway: "gateway",
  local_bridge_ready: "tunnel",
  preparing_bridge: "bridge",
  queued_on_pyrus: "request",
  retrying_tunnel: "tunnel",
  starting_bridge: "bridge",
  starting_gateway: "gateway",
  starting_ibc: "gateway",
  starting_tunnel: "tunnel",
  tunnel_reused: "tunnel",
  typing_gateway_credentials: "gateway",
  updating_helper: "update",
  updating_repo: "bridge",
  validating_tunnel: "tunnel",
  waiting_2fa: "twoFactor",
  waiting_bridge_gateway_api: "bridge",
  waiting_desktop_agent: "request",
  waiting_secure_credentials: "credentials",
  waiting_tunnel_dns: "tunnel",
};

function isoFromTimestamp(timestamp: number | null | undefined): string | null {
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function getActivationPhaseForProgress(
  event: LegacyBridgeActivationProgress | LegacyBridgeActivationProgressSnapshot | null,
): IbkrActivationTimelinePhase {
  const step = String(event?.step || "");
  if (step && IBKR_ACTIVATION_STEP_PHASE[step]) {
    return IBKR_ACTIVATION_STEP_PHASE[step];
  }
  const status = String(event?.status || "");
  if (status === "connected" || status === "starting_tunnel") {
    return "tunnel";
  }
  if (status === "starting_bridge") {
    return "bridge";
  }
  if (status === "waiting_gateway") {
    return "gateway";
  }
  return "request";
}

function getActivationProgressTime(
  event: LegacyBridgeActivationProgress,
): number {
  return event.updatedAt.getTime();
}

function buildEmptyPhaseDurations(): Record<
  IbkrActivationTimelinePhase,
  IbkrActivationPhaseTiming
> {
  return Object.fromEntries(
    IBKR_ACTIVATION_TIMELINE_PHASES.map((phase) => [
      phase.id,
      { completedAt: null, elapsedMs: null, startedAt: null },
    ]),
  ) as Record<IbkrActivationTimelinePhase, IbkrActivationPhaseTiming>;
}

function buildIbkrActivationInsight(input: {
  activation: LegacyBridgeActivation | null;
  activationId: string | null;
  recentProgress: LegacyBridgeActivationProgress[];
  now?: number;
}): IbkrActivationInsight {
  const now = input.now ?? Date.now();
  const phaseDurations = buildEmptyPhaseDurations();
  const activation = input.activation;
  if (!activation) {
    return {
      currentOwner: "none",
      currentPhase: "idle",
      currentPhaseElapsedMs: null,
      currentPhaseStartedAt: null,
      detail: "No IBKR launch is active.",
      normalAfterMs: null,
      phaseDurations,
      recommendedAction: null,
      severity: "idle",
      stale: false,
      staleAfterMs: null,
      timeline: IBKR_ACTIVATION_TIMELINE_PHASES.map((phase) => ({
        ...phaseDurations[phase.id],
        id: phase.id,
        label: phase.label,
        owner: phase.owner,
        status: "pending",
      })),
      title: "Idle",
    };
  }

  const phaseStartMs = new Map<IbkrActivationTimelinePhase, number>();
  const markPhaseStart = (
    phase: IbkrActivationTimelinePhase,
    timestamp: number | null | undefined,
  ) => {
    if (timestamp == null) {
      return;
    }
    const current = phaseStartMs.get(phase);
    if (current == null || timestamp < current) {
      phaseStartMs.set(phase, timestamp);
    }
  };

  markPhaseStart("request", activation.issuedAt);
  markPhaseStart("request", activation.remoteLaunchJobCreatedAt);
  markPhaseStart("request", activation.remoteLaunchJobClaimedAt);
  markPhaseStart("credentials", activation.loginKeyPublishedAt);
  markPhaseStart("credentials", activation.lastLoginKeyReadReadyAt);
  markPhaseStart("credentials", activation.lastLoginKeyReadAt);
  markPhaseStart("credentials", activation.loginEnvelopeReceivedAt);
  markPhaseStart("twoFactor", activation.lastLoginEnvelopeSubmitAttemptAt);
  markPhaseStart("twoFactor", activation.loginEnvelopeClaimedAt);

  for (const event of input.recentProgress) {
    markPhaseStart(getActivationPhaseForProgress(event), getActivationProgressTime(event));
  }

  const latestProgress = input.recentProgress.at(-1) ?? null;
  const latestStatus = String(latestProgress?.status || "");
  const latestStep = String(latestProgress?.step || "");
  const errorState = latestStatus === "error" || latestStep === "error";
  const canceledState =
    Boolean(activation.canceledAt) ||
    latestStatus === "canceled" ||
    latestStep === "cancel_requested";
  const connectedState = latestStatus === "connected" || latestStep === "connected";
  const activePhase = latestProgress
    ? getActivationPhaseForProgress(latestProgress)
    : "request";
  const activePhaseIndex = IBKR_ACTIVATION_PHASE_INDEX.get(activePhase) ?? 0;
  const terminalPhase: IbkrActivationPhase | null = errorState
    ? "error"
    : canceledState
      ? "canceled"
      : connectedState
        ? "complete"
        : null;
  const currentPhase = terminalPhase ?? activePhase;
  const currentPhaseStartedMs = phaseStartMs.get(activePhase) ?? activation.issuedAt;
  const currentPhaseElapsedMs = Math.max(0, now - currentPhaseStartedMs);
  const staleAfterMs =
    terminalPhase == null ? IBKR_ACTIVATION_STALE_AFTER_MS[activePhase] : null;
  const normalAfterMs =
    terminalPhase == null ? IBKR_ACTIVATION_NORMAL_AFTER_MS[activePhase] : null;
  const stale = Boolean(
    terminalPhase == null &&
      staleAfterMs != null &&
      currentPhaseElapsedMs >= staleAfterMs,
  );
  const phaseMeta = IBKR_ACTIVATION_PHASE_DETAIL[activePhase];
  const severity: IbkrActivationSeverity = errorState || canceledState
    ? "error"
    : connectedState
      ? "success"
      : stale
        ? "attention"
        : "progress";
  const currentOwner: IbkrActivationOwner = errorState
    ? "pyrus"
    : canceledState
      ? "user"
      : connectedState
        ? "none"
        : activePhase === "request" && latestStep === "waiting_desktop_agent"
          ? "desktopHelper"
          : phaseMeta
            ? IBKR_ACTIVATION_TIMELINE_PHASES.find((phase) => phase.id === activePhase)
                ?.owner ?? "pyrus"
            : "pyrus";

  for (const [index, phase] of IBKR_ACTIVATION_TIMELINE_PHASES.entries()) {
    const startedMs = phaseStartMs.get(phase.id) ?? null;
    const nextStartedMs =
      IBKR_ACTIVATION_TIMELINE_PHASES.slice(index + 1)
        .map((nextPhase) => phaseStartMs.get(nextPhase.id) ?? null)
        .find((value) => value != null) ?? null;
    const completedMs =
      startedMs != null && (index < activePhaseIndex || connectedState)
        ? nextStartedMs ?? now
        : null;
    phaseDurations[phase.id] = {
      completedAt: isoFromTimestamp(completedMs),
      elapsedMs:
        startedMs == null
          ? null
          : Math.max(0, (completedMs ?? now) - startedMs),
      startedAt: isoFromTimestamp(startedMs),
    };
  }

  const timeline = IBKR_ACTIVATION_TIMELINE_PHASES.map((phase, index) => {
    let status: IbkrActivationTimelineRow["status"] = "pending";
    if (terminalPhase === "canceled" && index === activePhaseIndex) {
      status = "canceled";
    } else if (terminalPhase === "error" && index === activePhaseIndex) {
      status = "error";
    } else if (connectedState || index < activePhaseIndex) {
      status = "complete";
    } else if (index === activePhaseIndex) {
      status = stale ? "attention" : "active";
    }
    return {
      ...phaseDurations[phase.id],
      id: phase.id,
      label: phase.label,
      owner: phase.owner,
      status,
    };
  });

  return {
    currentOwner,
    currentPhase,
    currentPhaseElapsedMs: terminalPhase == null ? currentPhaseElapsedMs : null,
    currentPhaseStartedAt:
      terminalPhase == null ? isoFromTimestamp(currentPhaseStartedMs) : null,
    detail:
      terminalPhase === "complete"
        ? "IB Gateway bridge is attached."
        : terminalPhase === "canceled"
          ? "The IBKR launch was canceled."
          : terminalPhase === "error"
            ? latestProgress?.message || "The IBKR launch reported an error."
            : phaseMeta.detail,
    normalAfterMs,
    phaseDurations,
    recommendedAction: terminalPhase == null && stale ? phaseMeta.action : null,
    severity,
    stale,
    staleAfterMs,
    timeline,
    title:
      terminalPhase === "complete"
        ? "Connected"
        : terminalPhase === "canceled"
          ? "Launch canceled"
          : terminalPhase === "error"
            ? "Launch error"
            : phaseMeta.title,
  };
}

export function readLegacyIbkrBridgeActivationStatus(
  activationId: string,
  body: unknown,
): LegacyBridgeActivationStatusResult {
  pruneLegacyBridgeActivations();
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge activation callback payload is required.", {
      code: "invalid_ibkr_bridge_activation_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const callbackSecret = readOptionalString(payload.callbackSecret, 160);
  const managementToken = readOptionalString(payload.managementToken, 160);
  if (!callbackSecret && !managementToken) {
    throw new HttpError(400, "Bridge activation status token is required.", {
      code: "invalid_ibkr_bridge_activation_payload",
    });
  }
  const activation = legacyBridgeActivations.get(activationId);
  if (!activation) {
    throw new HttpError(404, "IB Gateway bridge activation is no longer active.", {
      code: "ibkr_bridge_activation_not_found",
    });
  }
  const callbackMatches =
    callbackSecret != null &&
    safeStringEquals(activation.callbackSecret, callbackSecret);
  const managementMatches =
    managementToken != null &&
    safeStringEquals(activation.managementToken, managementToken);
  if (!callbackMatches && !managementMatches) {
    throw new HttpError(401, "IB Gateway bridge activation token is invalid.", {
      code: "invalid_ibkr_bridge_activation_token",
    });
  }
  assertLegacyBridgeActivationIsCurrent(activationId, activation, {
    allowCanceled: true,
  });
  const rawRecentProgress = legacyBridgeActivationProgress.get(activationId) ?? [];
  const recentProgress = rawRecentProgress.map(
    serializeLegacyBridgeActivationProgress,
  );

  return {
    active: true,
    canceled: Boolean(activation.canceledAt),
    expiresAt: new Date(activation.expiresAt).toISOString(),
    insight: buildIbkrActivationInsight({
      activation,
      activationId,
      recentProgress: rawRecentProgress,
    }),
    latestProgress: recentProgress.at(-1) ?? null,
    recentProgress,
  };
}

export function cancelLegacyIbkrBridgeActivation(
  activationId: string,
  body: unknown,
): { ok: true; canceled: true } {
  const activation = readLegacyBridgeActivationByManagementToken(
    activationId,
    body,
    { allowCanceled: true },
  );
  if (!activation.canceledAt) {
    activation.canceledAt = Date.now();
    appendLegacyBridgeActivationProgress({
      activationId,
      status: "canceled",
      step: "cancel_requested",
      message: "IB Gateway bridge launch was canceled from PYRUS.",
    });
    notifyLegacyActivationWaiters(activationId);
  }

  return { ok: true, canceled: true };
}

export function completeLegacyIbkrBridgeHelperUpdate(
  activationId: string,
  body: unknown,
): { completed: true; ok: true } {
  const activation = readLegacyBridgeActivation(activationId, body, {
    allowCanceled: true,
  });
  if (!activation.canceledAt) {
    activation.canceledAt = Date.now();
    appendLegacyBridgeActivationProgress({
      activationId,
      status: "completed",
      step: "helper_update_completed",
      message:
        "Pyrus IBKR helper update completed without starting IB Gateway.",
    });
    notifyLegacyActivationWaiters(activationId);
  }

  return { completed: true, ok: true };
}

export function submitLegacyIbkrBridgeLoginKey(
  activationId: string,
  body: unknown,
): { ok: true } {
  const activation = readLegacyBridgeActivation(activationId, body);
  const payload = body as Record<string, unknown>;
  const helperInstanceId = asString(
    payload.helperInstanceId,
    "helperInstanceId",
    160,
  );
  const algorithm = asString(payload.algorithm, "algorithm", 80);
  if (algorithm !== LOGIN_HANDOFF_ALGORITHM) {
    throw new HttpError(400, "IB Gateway login handoff algorithm is unsupported.", {
      code: "unsupported_ibkr_bridge_login_handoff_algorithm",
    });
  }

  const now = Date.now();
  activation.loginKeyPublishedAt = now;
  activation.loginHandoff = {
    algorithm: LOGIN_HANDOFF_ALGORITHM,
    createdAt: now,
    envelope: null,
    helperInstanceId,
    publicKeyJwk: readJsonObject(payload.publicKeyJwk, "publicKeyJwk"),
  };
  appendLegacyBridgeActivationProgress({
    activationId,
    status: "waiting_gateway",
    step: "credential_key_published",
    message:
      "Windows helper published the one-time credential encryption key to Pyrus.",
  });
  notifyWaiters(legacyLoginKeyWaiters, activationId);

  return { ok: true };
}

export function readLegacyIbkrBridgeLoginKey(
  activationId: string,
  body: unknown,
): LegacyBridgeLoginKeyReadResult {
  const activation = readLegacyBridgeActivationByManagementToken(
    activationId,
    body,
  );
  const now = Date.now();
  activation.loginKeyReadCount += 1;
  activation.lastLoginKeyReadAt = now;
  const handoff = activation.loginHandoff;
  if (!handoff) {
    return { ready: false };
  }
  const firstReadyRead = activation.lastLoginKeyReadReadyAt === null;
  activation.lastLoginKeyReadReadyAt = now;
  if (firstReadyRead) {
    appendLegacyBridgeActivationProgress({
      activationId,
      status: "waiting_gateway",
      step: "credential_key_read",
      message:
        "Pyrus read the Windows helper credential key and is preparing encrypted credentials.",
    });
  }

  return {
    algorithm: handoff.algorithm,
    expiresAt: new Date(activation.expiresAt).toISOString(),
    helperInstanceId: handoff.helperInstanceId,
    publicKeyJwk: handoff.publicKeyJwk,
    ready: true,
  };
}

export async function readLegacyIbkrBridgeLoginKeyWithWait(
  activationId: string,
  body: unknown,
): Promise<LegacyBridgeLoginKeyReadResult> {
  const initial = readLegacyIbkrBridgeLoginKey(activationId, body);
  const waitMs = readLongPollWaitMs(body);
  if (initial.ready || waitMs <= 0) {
    return initial;
  }

  await waitForNotification(legacyLoginKeyWaiters, activationId, waitMs);
  return readLegacyIbkrBridgeLoginKey(activationId, body);
}

export function submitLegacyIbkrBridgeLoginEnvelope(
  activationId: string,
  body: unknown,
): { alreadyAccepted?: true; alreadySubmitted?: true; ok: true } {
  const activation = readLegacyBridgeActivationByManagementToken(
    activationId,
    body,
  );
  const now = Date.now();
  activation.loginEnvelopeSubmitAttemptCount += 1;
  activation.lastLoginEnvelopeSubmitAttemptAt = now;
  activation.lastLoginEnvelopeSubmitErrorCode = null;
  const payload = body as Record<string, unknown>;
  const helperInstanceId = asString(
    payload.helperInstanceId,
    "helperInstanceId",
    160,
  );
  const algorithm = asString(payload.algorithm, "algorithm", 80);
  const rejectEnvelope = (
    status: number,
    code: string,
    message: string,
  ): HttpError => {
    activation.lastLoginEnvelopeSubmitErrorCode = code;
    recordConnectionAuditEvent({
      attemptId: activationId,
      actor: "pyrus",
      phase: "credentials",
      step: "login_envelope_rejected",
      status: "error",
      message,
      error: { code },
    });
    return new HttpError(status, message, { code });
  };
  if (algorithm !== LOGIN_HANDOFF_ALGORITHM) {
    throw rejectEnvelope(
      400,
      "unsupported_ibkr_bridge_login_handoff_algorithm",
      "IB Gateway login handoff algorithm is unsupported.",
    );
  }

  const handoff = activation.loginHandoff;
  if (!handoff) {
    if (
      activation.loginEnvelopeReceivedAt != null &&
      (!activation.loginEnvelopeHelperInstanceId ||
        safeStringEquals(activation.loginEnvelopeHelperInstanceId, helperInstanceId))
    ) {
      return { alreadyAccepted: true, ok: true };
    }
    throw rejectEnvelope(
      409,
      "ibkr_bridge_login_key_not_ready",
      "IB Gateway helper is not ready for credentials.",
    );
  }
  if (!safeStringEquals(handoff.helperInstanceId, helperInstanceId)) {
    throw rejectEnvelope(
      409,
      "ibkr_bridge_login_handoff_mismatch",
      "IB Gateway credential handoff helper changed.",
    );
  }
  if (handoff.envelope) {
    return { alreadySubmitted: true, ok: true };
  }

  handoff.envelope = {
    algorithm: LOGIN_HANDOFF_ALGORITHM,
    ciphertextChunks: readStringArray(payload.ciphertextChunks, "ciphertextChunks"),
    submittedAt: now,
  };
  activation.loginEnvelopeReceivedAt = now;
  activation.loginEnvelopeHelperInstanceId = helperInstanceId;
  // Credential-phase timing breakdown so a slow handoff can be localized from
  // the progress log: `pickup` is helper-key-published -> browser-read (a large
  // value points at the browser not polling, e.g. a backgrounded tab throttling
  // its timers); `deliver` is browser-read -> envelope-received (encrypt time
  // plus any wait on the user typing credentials).
  const keyPublishedAt = activation.loginKeyPublishedAt;
  const keyReadAt = activation.lastLoginKeyReadAt;
  const pickupMs =
    keyPublishedAt != null && keyReadAt != null ? keyReadAt - keyPublishedAt : null;
  const deliverMs = keyReadAt != null ? now - keyReadAt : null;
  const totalMs = keyPublishedAt != null ? now - keyPublishedAt : null;
  const timingSuffix =
    totalMs != null
      ? ` (credential phase ${totalMs}ms: key pickup ${pickupMs ?? "?"}ms, deliver ${deliverMs ?? "?"}ms)`
      : "";
  appendLegacyBridgeActivationProgress({
    activationId,
    status: "waiting_gateway",
    step: "credentials_received",
    message:
      "Encrypted IBKR credentials were received by Pyrus for the Windows helper." +
      timingSuffix,
  });
  notifyWaiters(legacyLoginEnvelopeWaiters, activationId);

  return { ok: true };
}

/**
 * Best-effort ingestion of browser-side connection events (the encrypt step, envelope-POST
 * outcome, timeouts, browser errors) that are otherwise invisible to the backend. Validated by
 * the management token the browser already holds; unknown/expired activations are ignored.
 */
export function recordIbkrBridgeBrowserConnectionEvent(
  activationId: string,
  body: unknown,
): { ok: true } {
  try {
    readLegacyBridgeActivationByManagementToken(activationId, body);
    const payload =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : {};
    const errorCode = readOptionalString(payload.errorCode, 120);
    const errorMessage = readOptionalString(payload.errorMessage, 300);
    recordConnectionAuditEvent({
      attemptId: activationId,
      actor: "browser",
      phase: readOptionalString(payload.phase, 40),
      step: readOptionalString(payload.step, 80) ?? "browser_event",
      status: readOptionalString(payload.status, 40),
      message: readOptionalString(payload.message, 300),
      error:
        errorCode || errorMessage
          ? { code: errorCode, message: errorMessage }
          : null,
    });
  } catch {
    // best-effort: never reject the browser's fire-and-forget diagnostic post.
  }
  return { ok: true };
}

export function claimLegacyIbkrBridgeLoginEnvelope(
  activationId: string,
  body: unknown,
): LegacyBridgeLoginEnvelopeClaimResult {
  const activation = readLegacyBridgeActivation(activationId, body, {
    allowCanceled: true,
  });
  const payload = body as Record<string, unknown>;
  if (activation.canceledAt) {
    return { ready: false, canceled: true };
  }
  const helperInstanceId = asString(
    payload.helperInstanceId,
    "helperInstanceId",
    160,
  );
  const handoff = activation.loginHandoff;
  if (!handoff || !safeStringEquals(handoff.helperInstanceId, helperInstanceId)) {
    return { ready: false };
  }
  if (!handoff.envelope) {
    return { ready: false };
  }

  const now = Date.now();
  // Past the re-claim window the one-time handoff is consumed for good: drop it
  // so a stale/duplicate claim can no longer re-deliver credentials.
  if (
    activation.loginEnvelopeClaimedAt != null &&
    now - activation.loginEnvelopeClaimedAt > LEGACY_LOGIN_ENVELOPE_RECLAIM_TTL_MS
  ) {
    activation.loginHandoff = null;
    notifyLegacyActivationWaiters(activationId);
    return { ready: false };
  }

  const envelope = handoff.envelope;
  // Record the first claim for two-factor phase timing, but retain the handoff
  // so the same helper instance can re-claim within the window above.
  if (activation.loginEnvelopeClaimedAt == null) {
    activation.loginEnvelopeClaimedAt = now;
  }
  notifyLegacyActivationWaiters(activationId);
  return {
    envelope: {
      algorithm: envelope.algorithm,
      ciphertextChunks: envelope.ciphertextChunks,
    },
    ready: true,
  };
}

export async function claimLegacyIbkrBridgeLoginEnvelopeWithWait(
  activationId: string,
  body: unknown,
): Promise<LegacyBridgeLoginEnvelopeClaimResult> {
  const initial = claimLegacyIbkrBridgeLoginEnvelope(activationId, body);
  const waitMs = readLongPollWaitMs(body);
  if (initial.ready || initial.canceled || waitMs <= 0) {
    return initial;
  }

  await waitForNotification(legacyLoginEnvelopeWaiters, activationId, waitMs);
  return claimLegacyIbkrBridgeLoginEnvelope(activationId, body);
}

export function getIbkrBridgeActivationDiagnostics(): {
  activeCount: number;
  latestActivation: {
    canceled: boolean;
    expiresAt: string;
    issuedAt: string;
    lastLoginEnvelopeSubmitAttemptAt: string | null;
    lastLoginEnvelopeSubmitErrorCode: string | null;
    lastLoginKeyReadAt: string | null;
    lastLoginKeyReadReadyAt: string | null;
    loginEnvelopeSubmitAttemptCount: number;
    loginEnvelopeSubmitted: boolean;
    loginEnvelopeSubmittedAt: string | null;
    loginHandoffCreatedAt: string | null;
    loginHandoffReady: boolean;
    loginKeyReadCount: number;
    progressStepTimings: Record<string, string>;
    timings: {
      issuedAt: string;
      launchJobClaimedAt: string | null;
      launchJobCreatedAt: string | null;
      loginEnvelopeClaimedAt: string | null;
      loginEnvelopeReceivedAt: string | null;
      loginEnvelopeSubmitAttemptAt: string | null;
      loginKeyPublishedAt: string | null;
      loginKeyReadAt: string | null;
      loginKeyReadReadyAt: string | null;
    };
  } | null;
  latestActivationId: string | null;
  desktopAgentRequests: IbkrRemoteDesktopRequestDiagnostic[];
  insight: IbkrActivationInsight;
  latestProgress: LegacyBridgeActivationProgress | null;
  recentProgress: LegacyBridgeActivationProgress[];
} {
  pruneLegacyBridgeActivations();
  const activeCount = Array.from(legacyBridgeActivations.values()).filter(
    (activation) => !activation.canceledAt,
  ).length;
  const recentProgress = latestLegacyBridgeActivationId
    ? (legacyBridgeActivationProgress.get(latestLegacyBridgeActivationId) ?? [])
    : [];
  const latestActivation = latestLegacyBridgeActivationId
    ? legacyBridgeActivations.get(latestLegacyBridgeActivationId) ?? null
    : null;
  const latestLoginHandoff = latestActivation?.loginHandoff ?? null;
  const latestLoginEnvelopeSubmittedAt =
    latestLoginHandoff?.envelope?.submittedAt ??
    latestActivation?.loginEnvelopeReceivedAt ??
    null;
  const toIso = (timestamp: number | null | undefined): string | null =>
    timestamp == null ? null : new Date(timestamp).toISOString();
  const progressStepTimings: Record<string, string> = {};
  for (const event of recentProgress) {
    if (event.step && !progressStepTimings[event.step]) {
      progressStepTimings[event.step] = event.updatedAt.toISOString();
    }
  }

  return {
    activeCount,
    desktopAgentRequests: [...ibkrRemoteDesktopRequestDiagnostics].reverse(),
    latestActivation: latestActivation
      ? {
          canceled: Boolean(latestActivation.canceledAt),
          expiresAt: new Date(latestActivation.expiresAt).toISOString(),
          issuedAt: new Date(latestActivation.issuedAt).toISOString(),
          lastLoginEnvelopeSubmitAttemptAt:
            latestActivation.lastLoginEnvelopeSubmitAttemptAt == null
              ? null
              : new Date(
                  latestActivation.lastLoginEnvelopeSubmitAttemptAt,
                ).toISOString(),
          lastLoginEnvelopeSubmitErrorCode:
            latestActivation.lastLoginEnvelopeSubmitErrorCode,
          lastLoginKeyReadAt:
            latestActivation.lastLoginKeyReadAt == null
              ? null
              : new Date(latestActivation.lastLoginKeyReadAt).toISOString(),
          lastLoginKeyReadReadyAt:
            latestActivation.lastLoginKeyReadReadyAt == null
              ? null
              : new Date(
                  latestActivation.lastLoginKeyReadReadyAt,
                ).toISOString(),
          loginEnvelopeSubmitAttemptCount:
            latestActivation.loginEnvelopeSubmitAttemptCount,
          loginEnvelopeSubmitted:
            latestActivation.loginEnvelopeReceivedAt != null ||
            Boolean(latestLoginHandoff?.envelope),
          loginEnvelopeSubmittedAt: toIso(latestLoginEnvelopeSubmittedAt),
          loginHandoffCreatedAt: latestLoginHandoff
            ? new Date(latestLoginHandoff.createdAt).toISOString()
            : null,
          loginHandoffReady: Boolean(latestLoginHandoff),
          loginKeyReadCount: latestActivation.loginKeyReadCount,
          progressStepTimings,
          timings: {
            issuedAt: new Date(latestActivation.issuedAt).toISOString(),
            launchJobClaimedAt: toIso(latestActivation.remoteLaunchJobClaimedAt),
            launchJobCreatedAt: toIso(latestActivation.remoteLaunchJobCreatedAt),
            loginEnvelopeClaimedAt: toIso(latestActivation.loginEnvelopeClaimedAt),
            loginEnvelopeReceivedAt: toIso(
              latestActivation.loginEnvelopeReceivedAt,
            ),
            loginEnvelopeSubmitAttemptAt: toIso(
              latestActivation.lastLoginEnvelopeSubmitAttemptAt,
            ),
            loginKeyPublishedAt: toIso(latestActivation.loginKeyPublishedAt),
            loginKeyReadAt: toIso(latestActivation.lastLoginKeyReadAt),
            loginKeyReadReadyAt: toIso(latestActivation.lastLoginKeyReadReadyAt),
          },
        }
      : null,
    latestActivationId: latestLegacyBridgeActivationId,
    insight: buildIbkrActivationInsight({
      activation: latestActivation,
      activationId: latestLegacyBridgeActivationId,
      recentProgress,
    }),
    latestProgress: recentProgress.at(-1) ?? null,
    recentProgress,
  };
}

export async function attachLegacyIbkrBridgeRuntime(
  activationId: string,
  body: unknown,
): Promise<AttachIbkrBridgeRuntimeResult> {
  pruneLegacyBridgeActivations();
  if (!legacyBridgeActivations.has(activationId)) {
    if (latestLegacyBridgeActivationId) {
      throw new HttpError(
        409,
        "IB Gateway bridge activation was superseded by a newer launch.",
        {
          code: "ibkr_bridge_activation_superseded",
        },
      );
    }
    if (!body || typeof body !== "object") {
      throw new HttpError(400, "Bridge activation callback payload is required.", {
        code: "invalid_ibkr_bridge_activation_payload",
      });
    }
    const payload = body as Record<string, unknown>;
    return attachIbkrBridgeRuntime({
      bridgeUrl: asString(payload.bridgeUrl, "bridgeUrl"),
      bridgeToken: readOptionalString(payload.bridgeToken, 160),
    });
  }

  const activation = readLegacyBridgeActivation(activationId, body);
  const payload = body as Record<string, unknown>;
  const suppliedBridgeToken = readOptionalString(payload.bridgeToken, 160);
  const bridgeToken = suppliedBridgeToken ?? activation.bridgeToken;

  const result = await attachIbkrBridgeRuntime({
    bridgeUrl: asString(payload.bridgeUrl, "bridgeUrl"),
    bridgeToken,
    managementToken: activation.managementToken,
    bridgeId: safeStringEquals(bridgeToken, activation.bridgeToken)
      ? activationId
      : null,
  });
  legacyBridgeActivations.delete(activationId);
  legacyBridgeActivationProgress.delete(activationId);
  if (latestLegacyBridgeActivationId === activationId) {
    latestLegacyBridgeActivationId = null;
  }

  return result;
}

export async function attachIbkrBridgeRuntime(
  body: unknown,
): Promise<AttachIbkrBridgeRuntimeResult> {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Bridge attach payload is required.", {
      code: "invalid_ibkr_bridge_attach_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const bridgeUrl = normalizeBridgeUrl(asString(payload.bridgeUrl, "bridgeUrl"));
  const bridgeToken =
    readOptionalString(payload.bridgeToken, 160) ??
    readOptionalString(payload.apiToken, 160);
  const managementToken = readOptionalString(payload.managementToken, 160);
  const bridgeId =
    readOptionalString(payload.bridgeId, 160) ??
    readOptionalString(payload.activationId, 160);
  pruneLegacyBridgeActivations();
  const activation = bridgeId ? legacyBridgeActivations.get(bridgeId) : null;
  if (bridgeId) {
    if (!activation) {
      if (latestLegacyBridgeActivationId) {
        throw new HttpError(
          409,
          "IB Gateway bridge activation was superseded by a newer launch.",
          {
            code: "ibkr_bridge_activation_superseded",
          },
        );
      }
    } else {
      assertLegacyBridgeActivationIsCurrent(bridgeId, activation);
      const managementTokenMatchesActivation =
        Boolean(managementToken) &&
        safeStringEquals(managementToken ?? "", activation.managementToken);
      if (
        bridgeToken &&
        !safeStringEquals(bridgeToken, activation.bridgeToken) &&
        !managementTokenMatchesActivation
      ) {
        throw new HttpError(401, "Bridge token is invalid.", {
          code: "invalid_ibkr_bridge_token",
        });
      }
    }
  }

  if (bridgeToken !== null && bridgeToken.length < 24) {
    throw new HttpError(401, "Bridge token is invalid.", {
      code: "invalid_ibkr_bridge_token",
    });
  }
  if (managementToken !== null && managementToken.length < 24) {
    throw new HttpError(401, "Bridge management token is invalid.", {
      code: "invalid_ibkr_bridge_management_token",
    });
  }

  // Validate health and load accounts concurrently. Both are independent ~20s
  // bridge reads on the final-attach hot path; running them sequentially
  // added up to another ~20s to every launch. Still surface a health failure
  // first so the error reflects an unhealthy bridge rather than a downstream
  // accounts read, and only trust accounts once health has been validated.
  const [healthResult, accountsResult] = await Promise.allSettled([
    fetchBridgeJson<unknown>(bridgeUrl, "/healthz", bridgeToken),
    fetchBridgeJson<unknown>(bridgeUrl, "/accounts", bridgeToken),
  ]);
  if (healthResult.status === "rejected") {
    throw healthResult.reason;
  }
  const health = healthResult.value;
  assertBridgeHealth(health);
  primeBridgeHealthForSession(health);
  if (accountsResult.status === "rejected") {
    throw accountsResult.reason;
  }
  const accounts = accountsResult.value;

  setIbkrBridgeRuntimeOverride(
    {
      baseUrl: bridgeUrl,
      apiToken: bridgeToken,
    },
    {
      managementTokenHash: managementToken
        ? hashManagementToken(managementToken)
        : null,
      bridgeId,
    },
  );
  recordConnectionAuditEvent({
    attemptId: bridgeId ?? null,
    actor: "pyrus",
    phase: "tunnel",
    step: "bridge_attached",
    status: "connected",
    message: "IBKR bridge runtime attached; health validated.",
    fields: { bridgeUrl },
  });
  if (bridgeId) {
    legacyBridgeActivations.delete(bridgeId);
    legacyBridgeActivationProgress.delete(bridgeId);
    notifyLegacyActivationWaiters(bridgeId);
    if (latestLegacyBridgeActivationId === bridgeId) {
      latestLegacyBridgeActivationId = null;
    }
  }

  return {
    runtimeOverrideActive: true,
    bridgeUrl,
    tokenConfigured: Boolean(bridgeToken),
    bridge: {
      health,
      accounts,
    },
  };
}

export function detachIbkrBridgeRuntime(body: unknown): {
  runtimeOverrideActive: false;
} {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Detach payload is required.", {
      code: "invalid_ibkr_bridge_detach_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const managementToken = asString(payload.managementToken, "managementToken", 160);
  const runtimeOverride = getIbkrBridgeRuntimeOverride();
  const expectedHash = runtimeOverride?.managementTokenHash;
  if (
    !expectedHash ||
    !safeStringEquals(expectedHash, hashManagementToken(managementToken))
  ) {
    throw new HttpError(401, "IB Gateway bridge detach token is invalid.", {
      code: "invalid_ibkr_bridge_detach_token",
    });
  }

  clearIbkrBridgeRuntimeOverride();
  invalidateBridgeHealthCache();
  recordConnectionAuditEvent({
    attemptId: null,
    actor: "pyrus",
    step: "bridge_detached",
    status: "disconnected",
    message: "IBKR bridge runtime detached (override cleared, health cache invalidated).",
  });

  return {
    runtimeOverrideActive: false,
  };
}

export function verifyIbkrBridgeManagementToken(body: unknown): void {
  if (!body || typeof body !== "object") {
    throw new HttpError(400, "Management token payload is required.", {
      code: "invalid_ibkr_bridge_management_payload",
    });
  }

  const payload = body as Record<string, unknown>;
  const managementToken = asString(payload.managementToken, "managementToken", 160);
  const runtimeOverride = getIbkrBridgeRuntimeOverride();
  const expectedHash = runtimeOverride?.managementTokenHash;
  if (
    !expectedHash ||
    !safeStringEquals(expectedHash, hashManagementToken(managementToken))
  ) {
    throw new HttpError(401, "IB Gateway bridge management token is invalid.", {
      code: "invalid_ibkr_bridge_management_token",
    });
  }
}

export function resetIbkrBridgeRuntimeStateForTests(): void {
  clearIbkrBridgeRuntimeOverride();
  legacyBridgeActivations.clear();
  legacyBridgeActivationProgress.clear();
  latestLegacyBridgeActivationId = null;
  ibkrRemoteDesktops.clear();
  ibkrRemoteLaunchJobs.clear();
  notifyAllWaiters(remoteDesktopJobWaiters);
  notifyAllWaiters(legacyLoginKeyWaiters);
  notifyAllWaiters(legacyLoginEnvelopeWaiters);
  ibkrRemoteDesktopsLoaded = true;
  rmSync(getIbkrRemoteDesktopsFile(), { force: true });
}
