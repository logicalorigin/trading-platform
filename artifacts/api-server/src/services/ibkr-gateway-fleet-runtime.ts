import {
  deriveIbkrHostControlKey,
  signIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";

import { HttpError } from "../lib/errors";
import { getRuntimeMode } from "../lib/runtime";
import {
  acknowledgeIbkrGatewayControlAttempt,
  beginIbkrGatewayControlAttempt,
  ensureIbkrGatewayBrokerConnection,
  ensureIbkrGatewaySessionIdentity,
  type IbkrGatewayControlAuthority,
  type IbkrGatewayFence,
  readCurrentIbkrGatewayFence,
  readIbkrGatewayBrokerConnection,
  renewIbkrGatewayCleanupLease,
  renewIbkrGatewayLease,
  resolveIbkrGatewayCleanupPlacement,
  resolveCurrentIbkrGatewayPlacement,
  tryAcquireIbkrGatewayLease,
} from "./ibkr-gateway-session-store";
import { readIbkrGatewayFleetRootKey } from "./ibkr-gateway-fleet-config";

const FLEET_CONTROL_TIMEOUT_MS = 20_000;
const FLEET_CONTROL_MAX_RESPONSE_BYTES = 64 * 1024;

export function isIbkrGatewayFleetEnabled(): boolean {
  return Boolean(readIbkrGatewayFleetRootKey());
}

export function normalizeIbkrGatewayPath(value: string): string {
  if (!value.startsWith("/") || value.includes("#")) {
    throw new HttpError(400, "The IBKR gateway request path is invalid.", {
      code: "ibkr_gateway_path_invalid",
      expose: false,
    });
  }
  const url = new URL(value, "http://ibkr-gateway.invalid");
  if (url.origin !== "http://ibkr-gateway.invalid") {
    throw new HttpError(400, "The IBKR gateway request path is invalid.", {
      code: "ibkr_gateway_path_invalid",
      expose: false,
    });
  }
  return `${url.pathname}${url.search}`;
}

export async function readIbkrGatewayFleetFence(
  appUserId: string,
): Promise<IbkrGatewayFence | null> {
  const connection = await readIbkrGatewayBrokerConnection({
    appUserId,
    mode: getRuntimeMode(),
  });
  return connection
    ? readCurrentIbkrGatewayFence({
        appUserId,
        brokerConnectionId: connection.id,
      })
    : null;
}

export async function ensureIbkrGatewayFleetFence(
  appUserId: string,
): Promise<IbkrGatewayFence> {
  const connection = await ensureIbkrGatewayBrokerConnection({
    appUserId,
    mode: getRuntimeMode(),
  });
  if (
    !connection ||
    !(await ensureIbkrGatewaySessionIdentity({
      appUserId,
      brokerConnectionId: connection.id,
    }))
  ) {
    throw new HttpError(503, "The IBKR gateway identity is unavailable.", {
      code: "ibkr_gateway_identity_unavailable",
      expose: true,
    });
  }
  const identity = { appUserId, brokerConnectionId: connection.id };
  const current = await readCurrentIbkrGatewayFence(identity);
  if (current) return current;
  const acquired = await tryAcquireIbkrGatewayLease(identity);
  if (acquired.status !== "acquired") {
    throw new HttpError(503, "All IBKR gateway fleet slots are in use.", {
      code: "ibkr_gateway_fleet_exhausted",
      expose: true,
    });
  }
  return acquired.fence;
}

async function fleetContext(
  fence: IbkrGatewayFence,
  authority: "cleanup" | "traffic" = "traffic",
  issueControlAttempt = false,
): Promise<{
  controlAttemptId: string | null;
  fence: IbkrGatewayFence;
  origin: string;
  rootKey: Buffer;
}> {
  const rootKey = readIbkrGatewayFleetRootKey();
  if (!rootKey) {
    throw new HttpError(503, "The IBKR gateway fleet is not configured.", {
      code: "ibkr_gateway_fleet_not_configured",
      expose: true,
    });
  }
  let controlAttemptId: string | null = null;
  let renewed: IbkrGatewayFence | null;
  if (issueControlAttempt) {
    const attempt = await beginIbkrGatewayControlAttempt(fence, authority);
    controlAttemptId = attempt?.controlAttemptId ?? null;
    renewed = attempt?.fence ?? null;
  } else {
    renewed =
      authority === "cleanup"
        ? await renewIbkrGatewayCleanupLease(fence)
        : await renewIbkrGatewayLease(fence);
  }
  if (!renewed) {
    throw new HttpError(
      409,
      "The IBKR gateway placement is no longer current.",
      {
        code: "ibkr_gateway_fence_stale",
        expose: true,
      },
    );
  }
  const placement =
    authority === "cleanup"
      ? await resolveIbkrGatewayCleanupPlacement(renewed)
      : await resolveCurrentIbkrGatewayPlacement(renewed);
  if (!placement || placement.hostId !== renewed.hostId) {
    throw new HttpError(
      409,
      "The IBKR gateway placement is no longer current.",
      {
        code: "ibkr_gateway_fence_stale",
        expose: true,
      },
    );
  }
  return {
    controlAttemptId,
    fence: renewed,
    origin: placement.controlOrigin,
    rootKey,
  };
}

export async function renewIbkrGatewayFleetFence(
  fence: IbkrGatewayFence,
): Promise<IbkrGatewayFence> {
  return (await fleetContext(fence)).fence;
}

function fleetRequestPath(fence: IbkrGatewayFence, suffix: string): string {
  return (
    `/sessions/${encodeURIComponent(fence.sessionId)}` +
    `/generations/${fence.generation}` +
    `/slots/${fence.slotNumber}${suffix}`
  );
}

async function readFleetJson<T>(response: Response): Promise<T> {
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > FLEET_CONTROL_MAX_RESPONSE_BYTES) {
          await reader.cancel().catch(() => undefined);
          throw new HttpError(
            502,
            "The IBKR session host returned an invalid response.",
            { code: "ibkr_session_host_response_invalid", expose: false },
          );
        }
        chunks.push(Buffer.from(chunk.value));
      }
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      502,
      "The IBKR session host returned an invalid response.",
      {
        cause: error,
        code: "ibkr_session_host_response_invalid",
        expose: false,
      },
    );
  }
}

export type IbkrGatewayFleetHostResponse<T> = {
  authority: IbkrGatewayControlAuthority;
  controlAttemptId: string;
  fence: IbkrGatewayFence;
  status: "not_found" | "ok";
  value: T;
};

export async function acknowledgeIbkrGatewayFleetControl(
  response: Pick<
    IbkrGatewayFleetHostResponse<unknown>,
    "authority" | "controlAttemptId" | "fence"
  >,
): Promise<void> {
  if (
    !(await acknowledgeIbkrGatewayControlAttempt(
      response.fence,
      response.controlAttemptId,
      response.authority,
    ))
  ) {
    throw new HttpError(
      409,
      "The IBKR gateway placement is no longer current.",
      { code: "ibkr_gateway_fence_stale", expose: true },
    );
  }
}

export async function requestIbkrGatewayFleetHost<T>(
  fence: IbkrGatewayFence,
  action: "ensure" | "release" | "status",
): Promise<IbkrGatewayFleetHostResponse<T>> {
  const method = action === "status" ? "GET" : "POST";
  const authority = action === "release" ? "cleanup" : "traffic";
  const current = await fleetContext(fence, authority, true);
  if (!current.controlAttemptId) {
    throw new HttpError(
      409,
      "The IBKR gateway placement is no longer current.",
      { code: "ibkr_gateway_fence_stale", expose: true },
    );
  }
  const path = fleetRequestPath(current.fence, `/${action}`);
  const key = deriveIbkrHostControlKey(current.rootKey, current.fence.hostId);
  let response: Response;
  try {
    response = await fetch(`${current.origin}${path}`, {
      method,
      headers: signIbkrHostControlRequest({
        hostId: current.fence.hostId,
        key,
        method,
        path,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(FLEET_CONTROL_TIMEOUT_MS),
    });
  } catch (error) {
    throw new HttpError(502, "The IBKR session host is unavailable.", {
      cause: error,
      code: "ibkr_session_host_unavailable",
      expose: true,
    });
  }
  if (action === "status" && response.status === 404) {
    return {
      authority,
      controlAttemptId: current.controlAttemptId,
      fence: current.fence,
      status: "not_found",
      value: await readFleetJson<T>(response),
    };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpError(
      response.status,
      "The IBKR session host control request failed.",
      { code: "ibkr_session_host_control_failed", expose: true },
    );
  }
  return {
    authority,
    controlAttemptId: current.controlAttemptId,
    fence: current.fence,
    status: "ok",
    value: await readFleetJson<T>(response),
  };
}

export async function prepareIbkrGatewayFleetDataRequest(input: {
  body?: string | Uint8Array;
  fence: IbkrGatewayFence;
  headers: Record<string, string | string[]>;
  kind: "cpg" | "console";
  method: string;
  path: string;
  transport: "http" | "websocket";
}): Promise<{
  fence: IbkrGatewayFence;
  headers: Record<string, string | string[]>;
  url: URL;
}> {
  const current = await fleetContext(input.fence);
  const path = fleetRequestPath(
    current.fence,
    `/data/${input.kind}${normalizeIbkrGatewayPath(input.path)}`,
  );
  const url = new URL(path, current.origin);
  Object.assign(
    input.headers,
    signIbkrHostControlRequest({
      body: input.body,
      hostId: current.fence.hostId,
      key: deriveIbkrHostControlKey(current.rootKey, current.fence.hostId),
      method: input.method,
      path: `${url.pathname}${url.search}`,
    }),
  );
  if (input.transport === "websocket") url.protocol = "wss:";
  input.headers.host = url.host;
  return { fence: current.fence, headers: input.headers, url };
}
