import { signIbkrHostControlRequest } from "@workspace/ibkr-contracts/control-auth";

import {
  CapsuleError,
  type RuntimeReadiness,
  type SessionHostConfig,
} from "./capsule";
import type { IbkrHostControlIdentity } from "./control-config";

const HOST_HEARTBEAT_INTERVAL_MS = 10_000;
const LIFECYCLE_REQUEST_TIMEOUT_MS = 5_000;
const LIFECYCLE_RESPONSE_MAX_BYTES = 16 * 1024;
const IDENTITY_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

type Registration = {
  workloadIdentityDigest: string;
  controlOrigin: string;
  imageDigest: string;
  runtimeSpecDigest: string;
  runtimeAttestationDigest: string;
  failureDomain: string;
  measuredSlotCapacity: number;
};

type Heartbeat = {
  verifiedWorkloadIdentityDigest: string;
  runtimeAttestationDigest: string;
};

export type IbkrHostLifecycleConfig = {
  apiOrigin: string;
  controlIdentity: IbkrHostControlIdentity;
  heartbeat: Heartbeat;
  registration: Registration;
};

export type IbkrHostLifecycleResult =
  | "busy"
  | "heartbeat"
  | "registered"
  | "request_failed"
  | "runtime_unready";

type LifecycleRequestInit = {
  body: string;
  headers: Record<string, string>;
  method: "POST";
  redirect: "error";
  signal: AbortSignal;
};

type LifecycleClientOptions = {
  nowSeconds?: () => number;
  onStatus?: (status: IbkrHostLifecycleResult) => void;
  readiness: () => RuntimeReadiness | Promise<RuntimeReadiness>;
  request?: (url: string, init: LifecycleRequestInit) => Promise<Response>;
};

function invalidLifecycleConfig(): CapsuleError {
  return new CapsuleError(
    "invalid_host_lifecycle_config",
    "IBKR session host lifecycle configuration is invalid.",
  );
}

function normalizeLoopbackApiOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]") ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function apiOriginFrom(
  env: Record<string, string | undefined>,
): string | null {
  const explicit = env["IBKR_SESSION_HOST_API_ORIGIN"]?.trim();
  if (explicit) return normalizeLoopbackApiOrigin(explicit);
  const portText = env["PYRUS_API_PORT"]?.trim() || "8080";
  const port = Number(portText);
  return Number.isInteger(port) && port >= 1 && port <= 65_535
    ? `http://127.0.0.1:${port}`
    : null;
}

function capsuleImageDigest(image: string): string | null {
  const match = /(?:^|@)(sha256:[0-9a-f]{64})$/.exec(image);
  return match?.[1] ?? null;
}

export function loadIbkrHostLifecycleConfig(input: {
  controlIdentity: IbkrHostControlIdentity | null;
  env?: Record<string, string | undefined>;
  hostConfig: SessionHostConfig;
}): IbkrHostLifecycleConfig | null {
  if (!input.controlIdentity) return null;
  const env = input.env ?? process.env;
  const apiOrigin = apiOriginFrom(env);
  const workloadIdentityDigest =
    env["IBKR_SESSION_HOST_WORKLOAD_IDENTITY_DIGEST"]?.trim() ?? "";
  const runtimeSpecDigest =
    env["IBKR_SESSION_HOST_RUNTIME_SPEC_DIGEST"]?.trim() ?? "";
  const runtimeAttestationDigest =
    env["IBKR_SESSION_HOST_RUNTIME_ATTESTATION_DIGEST"]?.trim() ?? "";
  const failureDomain =
    env["IBKR_SESSION_HOST_FAILURE_DOMAIN"]?.trim() ?? "";
  const imageDigest = capsuleImageDigest(input.hostConfig.capsuleImage);
  if (
    !apiOrigin ||
    !IDENTITY_DIGEST_PATTERN.test(workloadIdentityDigest) ||
    !SHA256_DIGEST_PATTERN.test(runtimeSpecDigest) ||
    !SHA256_DIGEST_PATTERN.test(runtimeAttestationDigest) ||
    !imageDigest ||
    failureDomain.length < 1 ||
    failureDomain.length > 128 ||
    /[\x00-\x1f\x7f]/.test(failureDomain)
  ) {
    throw invalidLifecycleConfig();
  }

  return {
    apiOrigin,
    controlIdentity: input.controlIdentity,
    heartbeat: {
      verifiedWorkloadIdentityDigest: workloadIdentityDigest,
      runtimeAttestationDigest,
    },
    registration: {
      workloadIdentityDigest,
      controlOrigin: `http://${input.hostConfig.bindHost}:${input.hostConfig.port}`,
      imageDigest,
      runtimeSpecDigest,
      runtimeAttestationDigest,
      failureDomain,
      measuredSlotCapacity: input.hostConfig.capacity,
    },
  };
}

async function validLifecycleResponse(
  response: Response,
  hostId: string,
): Promise<boolean> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  const contentLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > LIFECYCLE_RESPONSE_MAX_BYTES
  ) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return false;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > LIFECYCLE_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return false;
    }
    chunks.push(Buffer.from(chunk.value));
  }

  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      heartbeatExpiresAt?: unknown;
      hostId?: unknown;
      status?: unknown;
    };
    return (
      value.hostId === hostId &&
      (value.status === "active" ||
        value.status === "draining" ||
        value.status === "quarantined") &&
      typeof value.heartbeatExpiresAt === "string" &&
      Number.isFinite(Date.parse(value.heartbeatExpiresAt))
    );
  } catch {
    return false;
  }
}

export function createIbkrHostLifecycleClient(
  config: IbkrHostLifecycleConfig,
  options: LifecycleClientOptions,
): {
  runOnce: () => Promise<IbkrHostLifecycleResult>;
  start: () => void;
  stop: () => void;
} {
  const request = options.request ?? fetch;
  const nowSeconds =
    options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  let registered = false;
  let running: Promise<IbkrHostLifecycleResult> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let lastStatus: IbkrHostLifecycleResult | null = null;

  const report = (status: IbkrHostLifecycleResult): IbkrHostLifecycleResult => {
    if (status !== lastStatus) {
      lastStatus = status;
      options.onStatus?.(status);
    }
    return status;
  };

  const execute = async (): Promise<IbkrHostLifecycleResult> => {
    let readiness: RuntimeReadiness;
    try {
      readiness = await options.readiness();
    } catch {
      registered = false;
      return report("runtime_unready");
    }
    if (!readiness.ready) {
      registered = false;
      return report("runtime_unready");
    }

    const action = registered ? "heartbeat" : "register";
    const body = JSON.stringify(
      action === "heartbeat" ? config.heartbeat : config.registration,
    );
    const path =
      `/api/internal/ibkr/gateway-hosts/${config.controlIdentity.hostId}` +
      `/${action}`;
    try {
      const response = await request(`${config.apiOrigin}${path}`, {
        body,
        headers: {
          "content-type": "application/json",
          ...signIbkrHostControlRequest({
            body,
            hostId: config.controlIdentity.hostId,
            key: config.controlIdentity.key,
            method: "POST",
            path,
            timestampSeconds: nowSeconds(),
          }),
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(LIFECYCLE_REQUEST_TIMEOUT_MS),
      });
      if (
        !(await validLifecycleResponse(
          response,
          config.controlIdentity.hostId,
        ))
      ) {
        registered = false;
        return report("request_failed");
      }
      registered = true;
      return report(action === "heartbeat" ? "heartbeat" : "registered");
    } catch {
      registered = false;
      return report("request_failed");
    }
  };

  const runOnce = (): Promise<IbkrHostLifecycleResult> => {
    if (running) return Promise.resolve(report("busy"));
    running = execute().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    runOnce,
    start() {
      if (timer) return;
      void runOnce();
      timer = setInterval(() => void runOnce(), HOST_HEARTBEAT_INTERVAL_MS);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
  };
}
