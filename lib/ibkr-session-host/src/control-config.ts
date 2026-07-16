import { decodeIbkrHostControlKey } from "@workspace/ibkr-contracts/control-auth";

import { CapsuleError } from "./capsule";

const HOST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export type IbkrHostControlIdentity = {
  hostId: string;
  key: Buffer;
};

export function loadIbkrHostControlIdentity(
  env: Record<string, string | undefined> = process.env,
): IbkrHostControlIdentity | null {
  const hostId = env["IBKR_SESSION_HOST_ID"]?.trim();
  const encodedKey = env["IBKR_SESSION_HOST_CONTROL_KEY"]?.trim();
  if (!hostId && !encodedKey) return null;
  const key = encodedKey ? decodeIbkrHostControlKey(encodedKey) : null;
  if (!hostId || !HOST_ID_PATTERN.test(hostId) || !key) {
    throw new CapsuleError(
      "invalid_host_control_identity",
      "IBKR session host signed control identity is invalid.",
    );
  }
  return { hostId, key };
}
