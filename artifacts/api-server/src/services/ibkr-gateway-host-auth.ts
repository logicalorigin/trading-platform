import {
  deriveIbkrHostControlKey,
  verifyIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";

import { readIbkrGatewayFleetRootKey } from "./ibkr-gateway-fleet-config";

const MAX_REPLAY_NONCES = 4_096;

type HostRequest = {
  body?: string | Uint8Array;
  headers: Record<string, string | string[] | undefined>;
  hostId: string;
  method: string;
  path: string;
};

export function createIbkrGatewayHostRequestVerifier(
  options: {
    nowSeconds?: () => number;
    rootKey?: () => Uint8Array;
  } = {},
): (request: HostRequest) => boolean {
  const nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  const rootKey =
    options.rootKey ??
    (() => readIbkrGatewayFleetRootKey({ requireEnabled: false })!);
  const replayNonces = new Map<string, number>();

  return (request) => {
    const now = nowSeconds();
    const configuredRootKey = rootKey();
    let key: Buffer;
    try {
      key = deriveIbkrHostControlKey(configuredRootKey, request.hostId);
    } catch {
      return false;
    }
    const verification = verifyIbkrHostControlRequest({
      body: request.body,
      expectedHostId: request.hostId,
      headers: request.headers,
      key,
      method: request.method,
      nowSeconds: now,
      path: request.path,
    });
    if (!verification.valid) return false;

    for (const [nonce, expiresAt] of replayNonces) {
      if (expiresAt <= now) replayNonces.delete(nonce);
    }
    const replayKey = `${request.hostId}:${verification.nonce}`;
    if (replayNonces.has(replayKey) || replayNonces.size >= MAX_REPLAY_NONCES) {
      return false;
    }
    replayNonces.set(replayKey, verification.timestampSeconds + 31);
    return true;
  };
}
