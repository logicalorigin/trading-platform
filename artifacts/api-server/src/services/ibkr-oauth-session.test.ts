import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  computeDhChallenge,
  computeLiveSessionToken,
} from "../providers/ibkr/oauth-live-session";
import {
  acquireLiveSessionToken,
  IbkrOAuthNotConfiguredError,
  IbkrOAuthSessionManager,
  type IbkrOAuthCredentials,
  type OAuthHttp,
} from "./ibkr-oauth-session";

type HttpCall = {
  path: string;
  body: unknown;
  headers: Record<string, string>;
};

type TimerHandle = {
  callback: () => void | Promise<void>;
  ms: number;
  cleared: boolean;
  unrefCalled: boolean;
  unref: () => void;
};

const PRIME_HEX = "17";
const GENERATOR = 2;
const SECRET_BYTES = Buffer.from("0123456789abcdeffedcba9876543210", "hex");

function createCredentials(): IbkrOAuthCredentials {
  const signing = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const encryption = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
  });
  const encryptedSecret = crypto
    .publicEncrypt(
      {
        key: encryption.publicKey,
        padding: crypto.constants.RSA_PKCS1_PADDING,
      },
      SECRET_BYTES,
    )
    .toString("base64");

  return {
    consumerKey: "PYRUSCON1",
    signingKey: signing.privateKey,
    encryptionKey: encryption.privateKey,
    dhParam: PRIME_HEX,
    accessToken: "access-token-1",
    encryptedAccessTokenSecret: encryptedSecret,
    realm: "limited_poa",
    baseUrl: "https://api.ibkr.com/v1/api",
  };
}

function lstSignature(liveSessionToken: string, consumerKey: string): string {
  return crypto
    .createHmac("sha1", Buffer.from(liveSessionToken, "base64"))
    .update(Buffer.from(consumerKey, "utf8"))
    .digest("hex");
}

function createFakeHttp(args: {
  credentials: IbkrOAuthCredentials;
  clientRandoms: string[];
  serverRandoms: string[];
  expiresAt: () => Date;
}): OAuthHttp & { calls: HttpCall[]; liveSessionTokens: string[] } {
  let liveSessionCall = 0;
  const calls: HttpCall[] = [];
  const liveSessionTokens: string[] = [];

  return {
    calls,
    liveSessionTokens,
    async post(path, body, headers) {
      calls.push({ path, body, headers });

      if (path !== "/oauth/live_session_token") {
        return { ok: true };
      }

      const clientRandom = args.clientRandoms[liveSessionCall]!;
      const serverRandom = args.serverRandoms[liveSessionCall]!;
      const challenge = computeDhChallenge({
        primeHex: PRIME_HEX,
        generator: GENERATOR,
        randomHex: clientRandom,
      });
      assert.ok(headers.Authorization.includes('OAuth realm="limited_poa"'));
      assert.ok(headers.Authorization.includes('oauth_signature_method="RSA-SHA256"'));
      assert.ok(
        headers.Authorization.includes(
          `diffie_hellman_challenge="${challenge}"`,
        ),
      );

      const dhResponse = computeDhChallenge({
        primeHex: PRIME_HEX,
        generator: GENERATOR,
        randomHex: serverRandom,
      });
      const liveSessionToken = computeLiveSessionToken({
        dhResponseHex: challenge,
        randomHex: serverRandom,
        primeHex: PRIME_HEX,
        decryptedSecret: SECRET_BYTES,
      });
      liveSessionTokens.push(liveSessionToken);
      liveSessionCall += 1;

      return {
        diffie_hellman_response: dhResponse,
        live_session_token_signature: lstSignature(
          liveSessionToken,
          args.credentials.consumerKey,
        ),
        live_session_token_expiration: args.expiresAt().toISOString(),
      };
    },
  };
}

function createFakeTimers(): {
  timers: ConstructorParameters<typeof IbkrOAuthSessionManager>[0]["timers"];
  handles: TimerHandle[];
  fire: (index?: number) => Promise<void>;
} {
  const handles: TimerHandle[] = [];
  return {
    handles,
    timers: {
      setInterval(callback, ms) {
        const handle: TimerHandle = {
          callback,
          ms,
          cleared: false,
          unrefCalled: false,
          unref() {
            handle.unrefCalled = true;
          },
        };
        handles.push(handle);
        return handle;
      },
      clearInterval(handle) {
        (handle as TimerHandle).cleared = true;
      },
    },
    async fire(index = 0) {
      await handles[index]!.callback();
    },
  };
}

test("acquireLiveSessionToken sends the DH challenge and validates the fake response", async () => {
  const credentials = createCredentials();
  const clientRandom = "06";
  const http = createFakeHttp({
    credentials,
    clientRandoms: [clientRandom],
    serverRandoms: ["0b"],
    expiresAt: () => new Date("2026-07-09T00:00:00.000Z"),
  });

  const acquired = await acquireLiveSessionToken({
    credentials,
    http,
    randomHex: clientRandom,
    nonce: "fixednonce123456",
    timestamp: "1700000000",
    now: new Date("2026-07-08T00:00:00.000Z"),
  });

  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0]!.path, "/oauth/live_session_token");
  assert.deepEqual(http.calls[0]!.body, {});
  assert.equal(acquired.liveSessionToken, http.liveSessionTokens[0]);
  assert.equal(acquired.expiresAt.toISOString(), "2026-07-09T00:00:00.000Z");
});

test("IbkrOAuthSessionManager initializes, tickles, reauthenticates, and stops", async () => {
  const credentials = createCredentials();
  let nowMs = Date.parse("2026-07-08T00:00:00.000Z");
  const http = createFakeHttp({
    credentials,
    clientRandoms: ["06", "07"],
    serverRandoms: ["0b", "0d"],
    expiresAt: () => new Date(nowMs + 120_000),
  });
  const fakeTimers = createFakeTimers();
  const randoms = ["06", "07"];
  const manager = new IbkrOAuthSessionManager({
    http,
    timers: fakeTimers.timers,
    tickleIntervalMs: 60_000,
    randomHex: () => randoms.shift()!,
    nonce: () => "fixednonce123456",
    timestamp: () => "1700000000",
    now: () => new Date(nowMs),
  });

  const started = await manager.start("session-1", { credentials });

  assert.equal(started.liveSessionToken, http.liveSessionTokens[0]);
  assert.equal(fakeTimers.handles.length, 1);
  assert.equal(fakeTimers.handles[0]!.ms, 60_000);
  assert.equal(fakeTimers.handles[0]!.unrefCalled, true);
  assert.deepEqual(
    http.calls.map((call) => call.path),
    ["/oauth/live_session_token", "/iserver/auth/ssodh/init"],
  );
  assert.deepEqual(http.calls[1]!.body, { publish: true, compete: true });
  assert.ok(http.calls[1]!.headers.Authorization.includes("HMAC-SHA256"));

  nowMs += 60_000;
  await fakeTimers.fire();
  assert.equal(http.calls.at(-1)!.path, "/tickle");

  nowMs += 120_000;
  await fakeTimers.fire();
  assert.deepEqual(
    http.calls.slice(-2).map((call) => call.path),
    ["/oauth/live_session_token", "/iserver/auth/ssodh/init"],
  );
  assert.equal(http.liveSessionTokens.length, 2);

  manager.stop("session-1");
  assert.equal(fakeTimers.handles[0]!.cleared, true);
});

test("IbkrOAuthSessionManager not-configured path errors before transport calls", async () => {
  const calls: HttpCall[] = [];
  const http: OAuthHttp = {
    async post(path, body, headers) {
      calls.push({ path, body, headers });
      return { ok: true };
    },
  };
  const manager = new IbkrOAuthSessionManager({
    http,
    env: {},
    timers: createFakeTimers().timers,
  });

  await assert.rejects(
    () => manager.start("missing-credentials"),
    (error) =>
      error instanceof IbkrOAuthNotConfiguredError &&
      error.code === "ibkr_oauth_not_configured",
  );
  assert.equal(calls.length, 0);
});
