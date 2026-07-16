import { decodeIbkrHostControlKey } from "@workspace/ibkr-contracts/control-auth";

import { HttpError } from "../lib/errors";

export function readIbkrGatewayFleetRootKey(
  options: {
    env?: Record<string, string | undefined>;
    requireEnabled?: boolean;
  } = {},
): Buffer | null {
  const env = options.env ?? process.env;
  if (
    options.requireEnabled !== false &&
    env["IBKR_GATEWAY_FLEET_ENABLED"] !== "1"
  ) {
    return null;
  }
  const rootKey = decodeIbkrHostControlKey(
    env["IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY"]?.trim() ?? "",
  );
  if (!rootKey) {
    throw new HttpError(
      503,
      "The IBKR gateway fleet configuration is invalid.",
      { code: "ibkr_gateway_fleet_config_invalid", expose: true },
    );
  }
  return rootKey;
}
