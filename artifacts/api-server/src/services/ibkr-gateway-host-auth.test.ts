import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveIbkrHostControlKey,
  signIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";
import { createIbkrGatewayHostRequestVerifier } from "./ibkr-gateway-host-auth";

const HOST_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_HOST_ID = "00000000-0000-4000-8000-000000000002";
const ROOT_KEY = Buffer.alloc(32, 11);
const BODY = JSON.stringify({ status: "ready" });
const PATH = `/api/internal/ibkr/gateway-hosts/${HOST_ID}/heartbeat`;

function signedHeaders(input: {
  body?: string;
  hostId?: string;
  nonce: string;
  timestampSeconds?: number;
}) {
  const hostId = input.hostId ?? HOST_ID;
  return signIbkrHostControlRequest({
    body: input.body ?? BODY,
    hostId,
    key: deriveIbkrHostControlKey(ROOT_KEY, hostId),
    method: "POST",
    nonce: input.nonce,
    path: PATH,
    timestampSeconds: input.timestampSeconds ?? 1_000,
  });
}

test("accepts one exact host-signed lifecycle request and rejects replay", () => {
  const verify = createIbkrGatewayHostRequestVerifier({
    nowSeconds: () => 1_000,
    rootKey: () => ROOT_KEY,
  });
  const request = {
    body: BODY,
    headers: signedHeaders({ nonce: "1".repeat(32) }),
    hostId: HOST_ID,
    method: "POST",
    path: PATH,
  };

  assert.equal(verify(request), true);
  assert.equal(verify(request), false);
});

test("rejects altered, stale, and cross-host lifecycle requests", () => {
  const verify = createIbkrGatewayHostRequestVerifier({
    nowSeconds: () => 1_000,
    rootKey: () => ROOT_KEY,
  });

  assert.equal(
    verify({
      body: `${BODY} `,
      headers: signedHeaders({ nonce: "2".repeat(32) }),
      hostId: HOST_ID,
      method: "POST",
      path: PATH,
    }),
    false,
  );
  assert.equal(
    verify({
      body: BODY,
      headers: signedHeaders({ nonce: "3".repeat(32), timestampSeconds: 969 }),
      hostId: HOST_ID,
      method: "POST",
      path: PATH,
    }),
    false,
  );
  assert.equal(
    verify({
      body: BODY,
      headers: signedHeaders({
        hostId: OTHER_HOST_ID,
        nonce: "4".repeat(32),
      }),
      hostId: HOST_ID,
      method: "POST",
      path: PATH,
    }),
    false,
  );
});

test("does not disguise missing server configuration as bad host credentials", () => {
  const configurationError = new Error("configuration unavailable");
  const verify = createIbkrGatewayHostRequestVerifier({
    nowSeconds: () => 1_000,
    rootKey: () => {
      throw configurationError;
    },
  });

  assert.throws(
    () =>
      verify({
        body: BODY,
        headers: signedHeaders({ nonce: "5".repeat(32) }),
        hostId: HOST_ID,
        method: "POST",
        path: PATH,
      }),
    configurationError,
  );
});

test("bounds accepted lifecycle nonces until old entries expire", () => {
  let nowSeconds = 1_000;
  const verify = createIbkrGatewayHostRequestVerifier({
    nowSeconds: () => nowSeconds,
    rootKey: () => ROOT_KEY,
  });

  for (let index = 0; index < 4_096; index += 1) {
    const nonce = index.toString(16).padStart(32, "0");
    assert.equal(
      verify({
        body: BODY,
        headers: signedHeaders({ nonce }),
        hostId: HOST_ID,
        method: "POST",
        path: PATH,
      }),
      true,
    );
  }
  assert.equal(
    verify({
      body: BODY,
      headers: signedHeaders({ nonce: "f".repeat(32) }),
      hostId: HOST_ID,
      method: "POST",
      path: PATH,
    }),
    false,
  );

  nowSeconds = 1_031;
  assert.equal(
    verify({
      body: BODY,
      headers: signedHeaders({
        nonce: "e".repeat(32),
        timestampSeconds: nowSeconds,
      }),
      hostId: HOST_ID,
      method: "POST",
      path: PATH,
    }),
    true,
  );
});
