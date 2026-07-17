import assert from "node:assert/strict";
import test from "node:test";

import {
  decodeIbkrHostControlKey,
  deriveIbkrHostControlKey,
  signIbkrHostControlReceipt,
  signIbkrHostControlRequest,
  verifyIbkrHostControlReceipt,
  verifyIbkrHostControlRequest,
} from "@workspace/ibkr-contracts/control-auth";

import { CapsuleError } from "./capsule";
import { loadIbkrHostControlIdentity } from "./control-config";

const HOST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_HOST_ID = "22222222-2222-4222-8222-222222222222";
const KEY_TEXT = Buffer.alloc(32, 7).toString("base64url");
const KEY = decodeIbkrHostControlKey(KEY_TEXT)!;
const OVERLAP_KEY_TEXT = Buffer.alloc(32, 8).toString("base64url");
const OVERLAP_KEY = decodeIbkrHostControlKey(OVERLAP_KEY_TEXT)!;
const NOW_SECONDS = 1_784_200_000;
const CONTROL_ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const PATH =
  "/sessions/33333333-3333-4333-8333-333333333333/generations/7/slots/2/ensure";

test("signs a host-bound, replay-identifiable control request", () => {
  const headers = signIbkrHostControlRequest({
    body: "",
    hostId: HOST_ID,
    key: KEY,
    method: "POST",
    nonce: "a".repeat(32),
    path: PATH,
    timestampSeconds: NOW_SECONDS,
  });

  assert.deepEqual(
    verifyIbkrHostControlRequest({
      body: "",
      expectedHostId: HOST_ID,
      headers,
      key: KEY,
      method: "POST",
      nowSeconds: NOW_SECONDS + 10,
      path: PATH,
    }),
    {
      nonce: "a".repeat(32),
      timestampSeconds: NOW_SECONDS,
      valid: true,
    },
  );
  assert.match(headers.authorization, /^Pyrus-HMAC-SHA256 [a-f0-9]{64}$/);
  assert.equal(headers["x-pyrus-control-host"], HOST_ID);
  assert.equal(headers["x-pyrus-control-version"], "1");
});

test("binds one control attempt in the signed request path", () => {
  const controlPath = `${PATH}?controlAttemptId=${CONTROL_ATTEMPT_ID}`;
  const headers = signIbkrHostControlRequest({
    hostId: HOST_ID,
    key: KEY,
    method: "POST",
    nonce: "c".repeat(32),
    path: controlPath,
    timestampSeconds: NOW_SECONDS,
  });

  assert.equal(headers["x-pyrus-control-version"], "1");
  assert.deepEqual(
    verifyIbkrHostControlRequest({
      expectedHostId: HOST_ID,
      headers,
      key: KEY,
      method: "POST",
      nowSeconds: NOW_SECONDS,
      path: controlPath,
    }),
    {
      nonce: "c".repeat(32),
      timestampSeconds: NOW_SECONDS,
      valid: true,
    },
  );
  assert.deepEqual(
    verifyIbkrHostControlRequest({
      expectedHostId: HOST_ID,
      headers,
      key: KEY,
      method: "POST",
      nowSeconds: NOW_SECONDS,
      path: `${PATH}?controlAttemptId=55555555-5555-4555-8555-555555555555`,
    }),
    { valid: false },
  );
});

test("signs an exact response receipt bound to its request", () => {
  const body = JSON.stringify({
    action: "ensure",
    controlAttemptId: CONTROL_ATTEMPT_ID,
    sessionId: "33333333-3333-4333-8333-333333333333",
  });
  const headers = signIbkrHostControlReceipt({
    action: "ensure",
    body,
    controlAttemptId: CONTROL_ATTEMPT_ID,
    hostId: HOST_ID,
    key: KEY,
    status: 200,
  });
  const verify = (
    overrides: Partial<Parameters<typeof verifyIbkrHostControlReceipt>[0]>,
  ): boolean =>
    verifyIbkrHostControlReceipt({
      action: "ensure",
      body,
      controlAttemptId: CONTROL_ATTEMPT_ID,
      expectedHostId: HOST_ID,
      headers,
      key: KEY,
      status: 200,
      ...overrides,
    });

  assert.equal(headers["x-pyrus-control-receipt-version"], "1");
  assert.match(
    headers["x-pyrus-control-receipt"] ?? "",
    /^Pyrus-HMAC-SHA256 [a-f0-9]{64}$/,
  );
  assert.equal(verify({}), true);
  assert.equal(verify({ body: `${body} ` }), false);
  assert.equal(verify({ action: "release" }), false);
  assert.equal(
    verify({
      controlAttemptId: "55555555-5555-4555-8555-555555555555",
    }),
    false,
  );
  assert.equal(verify({ expectedHostId: OTHER_HOST_ID }), false);
  assert.equal(verify({ key: OVERLAP_KEY }), false);
  assert.equal(verify({ status: 404 }), false);
  assert.equal(verify({ body: undefined as never }), false);
  assert.throws(() =>
    signIbkrHostControlReceipt({
      action: "ensure",
      body: undefined as never,
      controlAttemptId: CONTROL_ATTEMPT_ID,
      hostId: HOST_ID,
      key: KEY,
      status: 200,
    }),
  );
  assert.equal(
    verify({
      headers: {
        ...headers,
        "x-pyrus-control-receipt-version": "2",
      },
    }),
    false,
  );
  assert.equal(
    verify({
      headers: signIbkrHostControlRequest({
        hostId: HOST_ID,
        key: KEY,
        method: "POST",
        nonce: "e".repeat(32),
        path: PATH,
        timestampSeconds: NOW_SECONDS,
      }),
    }),
    false,
  );
});

test("rejects tampering, another host, stale time, and malformed keys", () => {
  const headers = signIbkrHostControlRequest({
    body: "",
    hostId: HOST_ID,
    key: KEY,
    method: "POST",
    nonce: "b".repeat(32),
    path: PATH,
    timestampSeconds: NOW_SECONDS,
  });
  const verify = (
    overrides: Partial<Parameters<typeof verifyIbkrHostControlRequest>[0]>,
  ) =>
    verifyIbkrHostControlRequest({
      body: "",
      expectedHostId: HOST_ID,
      headers,
      key: KEY,
      method: "POST",
      nowSeconds: NOW_SECONDS,
      path: PATH,
      ...overrides,
    });

  assert.deepEqual(verify({ method: "GET" }), { valid: false });
  assert.deepEqual(verify({ path: `${PATH}/tampered` }), { valid: false });
  assert.deepEqual(verify({ body: "tampered" }), { valid: false });
  assert.deepEqual(verify({ expectedHostId: OTHER_HOST_ID }), { valid: false });
  assert.deepEqual(verify({ nowSeconds: NOW_SECONDS + 31 }), { valid: false });
  assert.deepEqual(
    verify({
      headers: { ...headers, authorization: `${headers.authorization}0` },
    }),
    { valid: false },
  );
  assert.equal(decodeIbkrHostControlKey("not-base64url"), null);
  assert.equal(
    decodeIbkrHostControlKey(Buffer.alloc(31).toString("base64url")),
    null,
  );
  assert.equal(decodeIbkrHostControlKey(`${KEY_TEXT}=`), null);
});

test("loads only a complete canonical signed host identity", () => {
  assert.equal(loadIbkrHostControlIdentity({}), null);
  assert.deepEqual(
    loadIbkrHostControlIdentity({
      IBKR_SESSION_HOST_CONTROL_KEY: KEY_TEXT,
      IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY: OVERLAP_KEY_TEXT,
      IBKR_SESSION_HOST_ID: HOST_ID,
    }),
    { hostId: HOST_ID, key: KEY, overlapKey: OVERLAP_KEY },
  );
  for (const env of [
    { IBKR_SESSION_HOST_ID: HOST_ID },
    { IBKR_SESSION_HOST_CONTROL_KEY: KEY_TEXT },
    {
      IBKR_SESSION_HOST_CONTROL_KEY: KEY_TEXT,
      IBKR_SESSION_HOST_ID: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
    },
    {
      IBKR_SESSION_HOST_CONTROL_KEY: "short",
      IBKR_SESSION_HOST_ID: HOST_ID,
    },
    {
      IBKR_SESSION_HOST_ID: HOST_ID,
      IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY: OVERLAP_KEY_TEXT,
    },
    {
      IBKR_SESSION_HOST_CONTROL_KEY: KEY_TEXT,
      IBKR_SESSION_HOST_ID: HOST_ID,
      IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY: "short",
    },
    {
      IBKR_SESSION_HOST_CONTROL_KEY: KEY_TEXT,
      IBKR_SESSION_HOST_ID: HOST_ID,
      IBKR_SESSION_HOST_OVERLAP_CONTROL_KEY: KEY_TEXT,
    },
  ]) {
    assert.throws(() => loadIbkrHostControlIdentity(env), CapsuleError);
  }
});

test("derives a distinct control key for every registered host", () => {
  const first = deriveIbkrHostControlKey(KEY, HOST_ID);
  const repeated = deriveIbkrHostControlKey(KEY, HOST_ID);
  const second = deriveIbkrHostControlKey(KEY, OTHER_HOST_ID);

  assert.equal(first.byteLength, 32);
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, second);
  assert.notDeepEqual(first, KEY);
});
