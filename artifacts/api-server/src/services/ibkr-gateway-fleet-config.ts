import { decodeIbkrHostControlKey } from "@workspace/ibkr-contracts/control-auth";

import { HttpError } from "../lib/errors";

type FleetRootKeyOptions = {
  env?: Record<string, string | undefined>;
  requireEnabled?: boolean;
};

export type IbkrGatewayFleetRootKeys = {
  primary: Buffer;
  overlap: Buffer | null;
};

function invalidFleetConfig(): never {
  throw new HttpError(
    503,
    "The IBKR gateway fleet configuration is invalid.",
    { code: "ibkr_gateway_fleet_config_invalid", expose: true },
  );
}

export function readIbkrGatewayFleetRootKeys(
  options: FleetRootKeyOptions = {},
): IbkrGatewayFleetRootKeys | null {
  const env = options.env ?? process.env;
  if (
    options.requireEnabled !== false &&
    env["IBKR_GATEWAY_FLEET_ENABLED"] !== "1"
  ) {
    return null;
  }
  const primary = decodeIbkrHostControlKey(
    env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"]?.trim() ?? "",
  );
  const encodedOverlap =
    env["IBKR_GATEWAY_FLEET_CONTROL_OVERLAP_ROOT_KEY"]?.trim() ?? "";
  const overlap = encodedOverlap
    ? decodeIbkrHostControlKey(encodedOverlap)
    : null;
  if (!primary || (encodedOverlap && !overlap) || overlap?.equals(primary)) {
    invalidFleetConfig();
  }
  return { primary, overlap };
}

export function readIbkrGatewayFleetRootKey(
  options: FleetRootKeyOptions = {},
): Buffer | null {
  return readIbkrGatewayFleetRootKeys(options)?.primary ?? null;
}
