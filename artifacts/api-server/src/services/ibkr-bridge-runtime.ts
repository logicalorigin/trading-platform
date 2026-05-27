import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { HttpError } from "../lib/errors";
import {
  clearIbkrBridgeRuntimeOverride,
  getIbkrBridgeRuntimeOverride,
  setIbkrBridgeRuntimeOverride,
} from "../lib/runtime";
import { primeBridgeHealthForSession } from "./platform-bridge-health";

const BRIDGE_VALIDATION_TIMEOUT_MS = 20_000;
const LEGACY_ACTIVATION_TTL_MS = 60 * 60_000;
const REMOTE_DESKTOP_STALE_MS = 90_000;
const REMOTE_LAUNCH_JOB_TTL_MS = 10 * 60_000;
const BRIDGE_HELPER_VERSION = "2026-05-27.launch-sequence-v24";
const PYRUS_IBKR_PROTOCOL_SCHEME = "pyrus-ibkr";
const LOGIN_HANDOFF_ALGORITHM = "RSA-OAEP-256-CHUNKED";
const REMOTE_DESKTOPS_FILE_ENV_NAMES = [
  "IBKR_BRIDGE_REMOTE_DESKTOPS_FILE",
  "PYRUS_IBKR_BRIDGE_REMOTE_DESKTOPS_FILE",
];
type IbkrProtocolScheme = typeof PYRUS_IBKR_PROTOCOL_SCHEME;

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

type IbkrRemoteDesktopSummary = {
  desktopId: string;
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

export type IbkrBridgeRuntimeSessionState = {
  runtimeOverrideActive: boolean;
  runtimeOverrideUpdatedAt: Date | null;
  desktopAgentOnline: boolean;
  desktopAgentHelperVersion: string | null;
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

type LegacyBridgeActivationStatusResult = {
  active: boolean;
  canceled: boolean;
  expiresAt: string;
  latestProgress: LegacyBridgeActivationProgressSnapshot | null;
  recentProgress: LegacyBridgeActivationProgressSnapshot[];
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
      if (latestLegacyBridgeActivationId === activationId) {
        latestLegacyBridgeActivationId = null;
      }
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

function resolveEffectiveIbkrRemoteHelper(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): { helperVersion: string | null; lastHeartbeatAt: number | null } {
  const currentHelperHeartbeatAt =
    desktop.helperHeartbeatAtByVersion[BRIDGE_HELPER_VERSION] ??
    (desktop.helperVersion === BRIDGE_HELPER_VERSION
      ? desktop.lastHeartbeatAt
      : null);
  if (isIbkrRemoteHelperHeartbeatOnline(currentHelperHeartbeatAt, now)) {
    return {
      helperVersion: BRIDGE_HELPER_VERSION,
      lastHeartbeatAt: currentHelperHeartbeatAt,
    };
  }

  const latestOnlineHelper = Object.entries(desktop.helperHeartbeatAtByVersion)
    .filter(([, timestamp]) =>
      isIbkrRemoteHelperHeartbeatOnline(timestamp, now),
    )
    .sort((left, right) => right[1] - left[1])[0];
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
  if (helperVersion === BRIDGE_HELPER_VERSION) {
    return true;
  }

  return !isIbkrRemoteHelperHeartbeatOnline(
    desktop.helperHeartbeatAtByVersion[BRIDGE_HELPER_VERSION],
    now,
  );
}

function summarizeIbkrRemoteDesktop(
  desktop: IbkrRemoteDesktop,
  now = Date.now(),
): IbkrRemoteDesktopSummary {
  const effectiveHelper = resolveEffectiveIbkrRemoteHelper(desktop, now);
  return {
    desktopId: desktop.desktopId,
    helperVersion: effectiveHelper.helperVersion ?? desktop.helperVersion,
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
  } else if (candidates[0]) {
    return candidates[0];
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
    }
  }
  const activationId = randomBytes(16).toString("hex");
  const callbackSecret = randomBytes(32).toString("hex");
  legacyBridgeActivations.set(activationId, {
    callbackSecret,
    bridgeToken: input.bridgeToken,
    canceledAt: null,
    loginHandoff: null,
    managementToken: input.managementToken,
    issuedAt: now,
    expiresAt: now + LEGACY_ACTIVATION_TTL_MS,
  });
  legacyBridgeActivationProgress.set(activationId, []);
  latestLegacyBridgeActivationId = activationId;

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
  helperUrl: string;
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
      helperUrl,
      managementToken,
      scheme: input.scheme,
    }),
    managementToken,
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
  const onlineDesktop =
    remoteDesktops.desktops.find((desktop) => desktop.online) ?? null;
  const desktopAgentHelperVersion = onlineDesktop?.helperVersion ?? null;
  const desktopAgentUpgradeRequired = Boolean(
    onlineDesktop && desktopAgentHelperVersion !== BRIDGE_HELPER_VERSION,
  );

  return {
    runtimeOverrideActive: Boolean(runtimeOverride),
    runtimeOverrideUpdatedAt: runtimeOverride?.updatedAt ?? null,
    desktopAgentOnline: Boolean(onlineDesktop),
    desktopAgentHelperVersion,
    desktopAgentExpectedHelperVersion: BRIDGE_HELPER_VERSION,
    desktopAgentUpgradeRequired,
    reconnectAvailable: Boolean(
      !runtimeOverride &&
        onlineDesktop &&
        desktopAgentHelperVersion === BRIDGE_HELPER_VERSION,
    ),
  };
}

export function registerIbkrRemoteDesktop(body: unknown): {
  desktop: IbkrRemoteDesktopSummary;
  helperVersion: string;
  ok: true;
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
    helperVersion: BRIDGE_HELPER_VERSION,
    ok: true,
  };
}

export function heartbeatIbkrRemoteDesktop(body: unknown): {
  desktop: IbkrRemoteDesktopSummary;
  helperVersion: string;
  ok: true;
  pendingJobCount: number;
} {
  const desktop = assertIbkrRemoteDesktopAuthenticated(body);
  const payload = body as Record<string, unknown>;
  const helperVersion =
    readOptionalString(payload.helperVersion, 120) ?? desktop.helperVersion;
  desktop.label = readOptionalString(payload.label, 160) ?? desktop.label;
  const now = Date.now();
  recordIbkrRemoteHelperHeartbeat(desktop, helperVersion, now);
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
    helperVersion: BRIDGE_HELPER_VERSION,
    ok: true,
    pendingJobCount,
  };
}

export function claimIbkrRemoteDesktopLaunchJob(body: unknown):
  | {
      helperVersion: string;
      ready: false;
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
} {
  const desktop = assertIbkrRemoteDesktopAuthenticated(body);
  const payload = body as Record<string, unknown>;
  const helperVersion =
    readOptionalString(payload.helperVersion, 120) ?? desktop.helperVersion;
  desktop.label = readOptionalString(payload.label, 160) ?? desktop.label;
  const now = Date.now();
  recordIbkrRemoteHelperHeartbeat(desktop, helperVersion, now);
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
      const launchUrl = rewriteIbkrProtocolScheme(
        job.launchUrl,
        selectIbkrProtocolSchemeForDesktop(desktop),
      );

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
    const launchUrl = rewriteIbkrProtocolScheme(
      job.launchUrl,
      selectIbkrProtocolSchemeForDesktop(desktop),
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
    helperVersion: BRIDGE_HELPER_VERSION,
    ready: false,
  };
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
  const desktop = selectIbkrRemoteDesktop(
    readOptionalString(payload.desktopId, 160),
  );
  const launcher = createIbkrBridgeLauncher({
    apiBaseUrl: input.apiBaseUrl,
    bundleUrl: input.bundleUrl,
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
    launchUrl: useAutoLogin ? launcher.autoLoginLaunchUrl : launcher.launchUrl,
    statusTokenHash: null,
  };
  ibkrRemoteLaunchJobs.set(jobId, job);

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

  if (activation.canceledAt) {
    throw new HttpError(409, "IB Gateway bridge activation was canceled.", {
      code: "ibkr_bridge_activation_canceled",
    });
  }

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
  const recentProgress = (legacyBridgeActivationProgress.get(activationId) ?? [])
    .map(serializeLegacyBridgeActivationProgress);

  return {
    active: true,
    canceled: Boolean(activation.canceledAt),
    expiresAt: new Date(activation.expiresAt).toISOString(),
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
    const events = legacyBridgeActivationProgress.get(activationId) ?? [];
    events.push({
      activationId,
      status: "canceled",
      step: "cancel_requested",
      message: "IB Gateway bridge launch was canceled from PYRUS.",
      helperVersion: BRIDGE_HELPER_VERSION,
      bridgeUrl: null,
      updatedAt: new Date(),
    });
    legacyBridgeActivationProgress.set(activationId, events.slice(-20));
  }

  return { ok: true, canceled: true };
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

  activation.loginHandoff = {
    algorithm: LOGIN_HANDOFF_ALGORITHM,
    createdAt: Date.now(),
    envelope: null,
    helperInstanceId,
    publicKeyJwk: readJsonObject(payload.publicKeyJwk, "publicKeyJwk"),
  };

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
  const handoff = activation.loginHandoff;
  if (!handoff) {
    return { ready: false };
  }

  return {
    algorithm: handoff.algorithm,
    expiresAt: new Date(activation.expiresAt).toISOString(),
    helperInstanceId: handoff.helperInstanceId,
    publicKeyJwk: handoff.publicKeyJwk,
    ready: true,
  };
}

export function submitLegacyIbkrBridgeLoginEnvelope(
  activationId: string,
  body: unknown,
): { ok: true } {
  const activation = readLegacyBridgeActivationByManagementToken(
    activationId,
    body,
  );
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

  const handoff = activation.loginHandoff;
  if (!handoff) {
    throw new HttpError(409, "IB Gateway helper is not ready for credentials.", {
      code: "ibkr_bridge_login_key_not_ready",
    });
  }
  if (!safeStringEquals(handoff.helperInstanceId, helperInstanceId)) {
    throw new HttpError(409, "IB Gateway credential handoff helper changed.", {
      code: "ibkr_bridge_login_handoff_mismatch",
    });
  }
  if (handoff.envelope) {
    throw new HttpError(409, "IB Gateway credentials were already submitted.", {
      code: "ibkr_bridge_login_envelope_already_submitted",
    });
  }

  handoff.envelope = {
    algorithm: LOGIN_HANDOFF_ALGORITHM,
    ciphertextChunks: readStringArray(payload.ciphertextChunks, "ciphertextChunks"),
    submittedAt: Date.now(),
  };

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

  const envelope = handoff.envelope;
  activation.loginHandoff = null;
  return {
    envelope: {
      algorithm: envelope.algorithm,
      ciphertextChunks: envelope.ciphertextChunks,
    },
    ready: true,
  };
}

export function getIbkrBridgeActivationDiagnostics(): {
  activeCount: number;
  latestActivationId: string | null;
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

  return {
    activeCount,
    latestActivationId: latestLegacyBridgeActivationId,
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

  const health = await fetchBridgeJson<unknown>(
    bridgeUrl,
    "/healthz",
    bridgeToken,
  );
  assertBridgeHealth(health);
  primeBridgeHealthForSession(health);
  const accounts = await fetchBridgeJson<unknown>(
    bridgeUrl,
    "/accounts",
    bridgeToken,
  );

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
  if (bridgeId) {
    legacyBridgeActivations.delete(bridgeId);
    legacyBridgeActivationProgress.delete(bridgeId);
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
  ibkrRemoteDesktopsLoaded = true;
  rmSync(getIbkrRemoteDesktopsFile(), { force: true });
}
