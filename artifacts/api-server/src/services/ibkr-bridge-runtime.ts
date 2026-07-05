import { randomBytes } from "node:crypto";
import { HttpError } from "../lib/errors";

const RETIRED_HELPER_VERSION = "retired-ibkr-desktop-bridge";
const RETIRED_MESSAGE =
  "The legacy IBKR desktop bridge has been retired. Use the app-owned broker/client-portal runtime instead.";

type IbkrRemoteHelperCompatibility = "compatible" | "known_bad" | "update_required";

export type IbkrBridgeRuntimeSessionState = {
  runtimeOverrideActive: boolean;
  runtimeOverrideUpdatedAt: Date | null;
  bridgeRuntimeAttached: boolean;
  bridgeRuntimeStatus: "attached" | "desktop_agent_online_not_attached" | "detached";
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

export type IbkrBridgeSelfHealOutcome =
  | "queued"
  | "in-flight"
  | "throttled"
  | "exhausted"
  | "declined";

type DesktopSummary = {
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

type RetiredHelperResponse = {
  ok: true;
  ready: false;
  retired: true;
  message: string;
  helperUpdateRequired: true;
  helperVersion: string;
  targetHelperVersion: string;
  helperUrl: string;
};

function apiBaseUrl(input?: { apiBaseUrl?: string | null }): string {
  return input?.apiBaseUrl?.replace(/\/+$/, "") || "";
}

function retiredHelperUrl(input?: { apiBaseUrl?: string | null }): string {
  const baseUrl = apiBaseUrl(input);
  return baseUrl ? `${baseUrl}/api/ibkr/bridge/helper.ps1` : "/api/ibkr/bridge/helper.ps1";
}

function retiredHelperResponse(input?: { apiBaseUrl?: string | null }): RetiredHelperResponse {
  return {
    ok: true,
    ready: false,
    retired: true,
    message: RETIRED_MESSAGE,
    helperUpdateRequired: true,
    helperVersion: RETIRED_HELPER_VERSION,
    targetHelperVersion: RETIRED_HELPER_VERSION,
    helperUrl: retiredHelperUrl(input),
  };
}

function retiredError(): HttpError {
  return new HttpError(410, RETIRED_MESSAGE, {
    code: "ibkr_desktop_bridge_retired",
    expose: true,
  });
}

export function getRetiredIbkrBridgeHelperScript(): string {
  return String.raw`# PYRUS retired IBKR desktop bridge helper.
param(
  [switch]$Install,
  [switch]$InstallAgent,
  [switch]$Agent,
  [string]$ApiBaseUrl
)

$ErrorActionPreference = 'SilentlyContinue'
$StateDir = Join-Path $env:LOCALAPPDATA 'Pyrus\ibkr-bridge'
$TaskName = 'Pyrus IBKR Desktop Agent'

try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false | Out-Null } catch {}
try {
  $startup = [Environment]::GetFolderPath('Startup')
  Remove-Item (Join-Path $startup 'Pyrus IBKR Desktop Agent.cmd') -Force
} catch {}
try {
  Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -match 'pyrus-ibkr-helper\.ps1' -or
      $_.CommandLine -match 'Pyrus IBKR Desktop Agent'
    } |
    ForEach-Object {
      if ($_.ProcessId -ne $PID) {
        Stop-Process -Id $_.ProcessId -Force
      }
    }
} catch {}
try { Remove-Item $StateDir -Recurse -Force } catch {}

Write-Host 'The legacy PYRUS IBKR desktop bridge helper has been retired and removed from this Windows user.'
exit 0
`;
}

export function requestIbkrBridgeSelfHeal(..._args: unknown[]): IbkrBridgeSelfHealOutcome {
  return "declined";
}

export function __resetIbkrBridgeSelfHealForTests(): void {}

export function __setIbkrBridgeIntentionalStopForTests(_at: number | null): void {}

export function __markLatestLaunchJobForTests(_patch: {
  action?: "launch" | "shutdown";
  claimedAt?: number | null;
  completedAt?: number | null;
  createdAt?: number;
  failedAt?: number | null;
  launchUrl?: string | null;
  statusTokenHash?: string | null;
}): void {}

export function recordIbkrRemoteDesktopRouteAttempt(..._args: unknown[]): void {}

export function recordIbkrRemoteDesktopRawRequestAttempt(..._args: unknown[]): void {}

export function getIbkrBridgeLauncher(input: {
  apiBaseUrl: string;
  bundleUrl?: string | null;
}) {
  return {
    ...retiredHelperResponse(input),
    activationId: randomBytes(8).toString("hex"),
    apiBaseUrl: input.apiBaseUrl,
    autoLoginConfigured: null,
    autoLoginLaunchUrl: "",
    autoLoginMode: "ib-gateway-live" as const,
    autoLoginSupported: false,
    bridgeToken: "",
    bundleUrl: null,
    credentialHandoff: null,
    launchUrl: "",
    managementToken: "",
    updateOnlyLaunchUrl: "",
  };
}

export function listIbkrRemoteDesktops(): {
  desktops: DesktopSummary[];
  helperVersion: string;
  onlineCount: number;
} {
  return {
    desktops: [],
    helperVersion: RETIRED_HELPER_VERSION,
    onlineCount: 0,
  };
}

export function getIbkrBridgeRuntimeSessionState(): IbkrBridgeRuntimeSessionState {
  return {
    runtimeOverrideActive: false,
    runtimeOverrideUpdatedAt: null,
    bridgeRuntimeAttached: false,
    bridgeRuntimeStatus: "detached",
    bridgeRuntimeReason: "ibkr_bridge_not_configured",
    desktopAgentRegistered: false,
    desktopAgentRegisteredCount: 0,
    desktopAgentOnline: false,
    desktopAgentCompatibility: null,
    desktopAgentCompatible: false,
    desktopAgentHelperVersion: null,
    desktopAgentKnownBad: false,
    desktopAgentExpectedHelperVersion: RETIRED_HELPER_VERSION,
    desktopAgentUpgradeRequired: false,
    reconnectAvailable: false,
  };
}

export function getIbkrBridgeHelperMetadata() {
  return {
    desktops: [],
    helperVersion: RETIRED_HELPER_VERSION,
    latestDesktop: null,
    onlineCount: 0,
    onlineDesktop: null,
    retired: true,
    message: RETIRED_MESSAGE,
    runtime: {
      ...getIbkrBridgeRuntimeSessionState(),
      runtimeOverrideUpdatedAt: null,
    },
  };
}

export function registerIbkrRemoteDesktop(..._args: unknown[]): RetiredHelperResponse {
  return retiredHelperResponse();
}

export function heartbeatIbkrRemoteDesktop(..._args: unknown[]): RetiredHelperResponse & {
  pendingJobCount: number;
} {
  return {
    ...retiredHelperResponse(),
    pendingJobCount: 0,
  };
}

export function claimIbkrRemoteDesktopLaunchJob(..._args: unknown[]): RetiredHelperResponse {
  return retiredHelperResponse();
}

export async function claimIbkrRemoteDesktopLaunchJobWithWait(
  ..._args: unknown[]
): Promise<RetiredHelperResponse> {
  return retiredHelperResponse();
}

export function createIbkrRemoteBridgeLaunch(input: {
  apiBaseUrl: string;
  body?: unknown;
  bundleUrl?: string | null;
}) {
  return {
    ...getIbkrBridgeLauncher(input),
    remoteLaunch: null,
  };
}

export function createIbkrRemoteBridgeShutdown(input: {
  apiBaseUrl: string;
  body?: unknown;
}) {
  return {
    ...retiredHelperResponse(input),
    shutdown: null,
  };
}

export function readIbkrRemoteDesktopJobStatus(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
    state: "retired",
    message: RETIRED_MESSAGE,
  };
}

export function completeIbkrRemoteDesktopJob(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
    message: RETIRED_MESSAGE,
  };
}

export function recordLegacyIbkrBridgeActivationProgress(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
  };
}

export function readLegacyIbkrBridgeActivationStatus(..._args: unknown[]) {
  return {
    active: false,
    canceled: true,
    expiresAt: new Date().toISOString(),
    insight: {
      currentPhase: "canceled",
      currentOwner: "none",
      currentPhaseStartedAt: null,
      currentPhaseElapsedMs: null,
      detail: RETIRED_MESSAGE,
      normalAfterMs: null,
      phaseDurations: {},
      recommendedAction: null,
      severity: "idle",
      stale: false,
      staleAfterMs: null,
      timeline: [],
      title: "Legacy IBKR desktop bridge retired",
    },
    latestProgress: null,
    recentProgress: [],
    revision: 0,
    retired: true,
  };
}

export async function readLegacyIbkrBridgeActivationStatusWithWait(
  ..._args: unknown[]
) {
  return readLegacyIbkrBridgeActivationStatus();
}

export function cancelLegacyIbkrBridgeActivation(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
    canceled: true,
  };
}

export function completeLegacyIbkrBridgeHelperUpdate(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
  };
}

export function submitLegacyIbkrBridgeLoginKey(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
  };
}

export function readLegacyIbkrBridgeLoginKey(..._args: unknown[]) {
  return {
    ready: false,
    canceled: true,
    retired: true,
  };
}

export async function readLegacyIbkrBridgeLoginKeyWithWait(..._args: unknown[]) {
  return readLegacyIbkrBridgeLoginKey();
}

export function submitLegacyIbkrBridgeLoginEnvelope(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
  };
}

export function recordIbkrBridgeBrowserConnectionEvent(..._args: unknown[]) {
  return {
    ok: true,
    retired: true,
  };
}

export function claimLegacyIbkrBridgeLoginEnvelope(..._args: unknown[]) {
  return {
    ready: false,
    canceled: true,
    retired: true,
  };
}

export async function claimLegacyIbkrBridgeLoginEnvelopeWithWait(
  ..._args: unknown[]
) {
  return claimLegacyIbkrBridgeLoginEnvelope();
}

export function getIbkrBridgeActivationDiagnostics() {
  return {
    activeCount: 0,
    desktopAgentRequests: [],
    insight: readLegacyIbkrBridgeActivationStatus().insight,
    latestActivation: null,
    latestActivationId: null,
    latestProgress: null,
    recentProgress: [],
    retired: true,
    message: RETIRED_MESSAGE,
  };
}

export async function attachLegacyIbkrBridgeRuntime(..._args: unknown[]): Promise<never> {
  throw retiredError();
}

export async function attachIbkrBridgeRuntime(..._args: unknown[]): Promise<never> {
  throw retiredError();
}

export function detachIbkrBridgeRuntime(..._args: unknown[]) {
  return {
    runtimeOverrideActive: false,
    retired: true,
    message: RETIRED_MESSAGE,
  };
}

export function verifyIbkrBridgeManagementToken(..._args: unknown[]): void {
  throw retiredError();
}

export function resetIbkrBridgeRuntimeStateForTests(): void {}
