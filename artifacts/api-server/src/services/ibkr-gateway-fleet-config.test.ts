import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../lib/errors";
import { readIbkrGatewayFleetRootKey } from "./ibkr-gateway-fleet-config";

const ROOT_KEY = Buffer.alloc(32, 7).toString("base64url");

test("host lifecycle can read the fleet root key before fleet routing is enabled", () => {
  const env = {
    IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: ROOT_KEY,
    IBKR_GATEWAY_FLEET_ENABLED: "0",
  };

  assert.equal(readIbkrGatewayFleetRootKey({ env }), null);
  assert.deepEqual(
    readIbkrGatewayFleetRootKey({ env, requireEnabled: false }),
    Buffer.alloc(32, 7),
  );
});

test("an enabled or lifecycle fleet root key must be valid", () => {
  for (const input of [
    {
      env: {
        IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: "invalid",
        IBKR_GATEWAY_FLEET_ENABLED: "1",
      },
    },
    {
      env: {
        IBKR_GATEWAY_FLEET_CONTROL_ROOT_KEY: "",
        IBKR_GATEWAY_FLEET_ENABLED: "0",
      },
      requireEnabled: false,
    },
  ]) {
    assert.throws(
      () => readIbkrGatewayFleetRootKey(input),
      (error: unknown) =>
        error instanceof HttpError &&
        error.statusCode === 503 &&
        error.code === "ibkr_gateway_fleet_config_invalid",
    );
  }
});
