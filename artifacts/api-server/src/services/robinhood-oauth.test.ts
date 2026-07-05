import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  completeRobinhoodConnect,
  getRobinhoodAccessToken,
  startRobinhoodConnect,
  ROBINHOOD_OAUTH_AUTHORIZATION_URL,
  ROBINHOOD_OAUTH_REGISTRATION_URL,
  ROBINHOOD_OAUTH_TOKEN_URL,
} from "./robinhood-oauth";
import {
  beginRobinhoodConnectCustody,
  loadRobinhoodTokens,
  readRobinhoodUserReadiness,
  storeRobinhoodTokens,
} from "./robinhood-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64url");
const TEST_ENV = {
  ROBINHOOD_OAUTH_REDIRECT_BASE_URL: "https://pyrus.example",
};
const EXPECTED_REDIRECT_URI =
  "https://pyrus.example/api/broker-execution/robinhood/oauth/callback";

async function withBootstrapToken<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
  process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = "setup-token";
  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"];
    } else {
      process.env["PYRUS_AUTH_BOOTSTRAP_TOKEN"] = previous;
    }
  }
}

async function createUser(email: string) {
  return bootstrapInitialUser({
    email,
    password: "correct horse battery staple",
    bootstrapToken: "setup-token",
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("startRobinhoodConnect registers a public client and returns a PKCE consent URL", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const registrationBodies: unknown[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        assert.equal(String(url), ROBINHOOD_OAUTH_REGISTRATION_URL);
        registrationBodies.push(JSON.parse(String(init?.body)));
        return jsonResponse({ client_id: "client-abc" });
      };

      const started = await startRobinhoodConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-02T18:00:00.000Z"),
      });

      assert.equal(registrationBodies.length, 1);
      const registration = registrationBodies[0] as Record<string, unknown>;
      assert.deepEqual(registration["redirect_uris"], [EXPECTED_REDIRECT_URI]);
      assert.equal(registration["token_endpoint_auth_method"], "none");

      const url = new URL(started.authorizationUrl);
      assert.equal(
        `${url.origin}${url.pathname}`,
        ROBINHOOD_OAUTH_AUTHORIZATION_URL,
      );
      assert.equal(url.searchParams.get("client_id"), "client-abc");
      assert.equal(url.searchParams.get("redirect_uri"), EXPECTED_REDIRECT_URI);
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.equal(url.searchParams.get("scope"), "internal");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("state"), started.state);
      assert.ok(url.searchParams.get("code_challenge"));

      const readiness = await readRobinhoodUserReadiness(auth.user.id);
      assert.equal(readiness.status, "pending");
      assert.equal(readiness.nextAction, "complete_authorization");
    }),
  );
});

test("completeRobinhoodConnect exchanges the code with the stored PKCE verifier and stores tokens", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      const startFetch: typeof fetch = async () =>
        jsonResponse({ client_id: "client-abc" });
      const started = await startRobinhoodConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: startFetch,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      const expectedChallenge = new URL(
        started.authorizationUrl,
      ).searchParams.get("code_challenge");

      const tokenBodies: URLSearchParams[] = [];
      const completeFetch: typeof fetch = async (url, init) => {
        assert.equal(String(url), ROBINHOOD_OAUTH_TOKEN_URL);
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          scope: "internal",
        });
      };

      const readiness = await completeRobinhoodConnect({
        appUserId: auth.user.id,
        code: "auth-code-1",
        state: started.state,
        env: TEST_ENV,
        fetchImpl: completeFetch,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date(now.getTime() + 60_000),
      });

      assert.equal(tokenBodies.length, 1);
      const body = tokenBodies[0]!;
      assert.equal(body.get("grant_type"), "authorization_code");
      assert.equal(body.get("code"), "auth-code-1");
      assert.equal(body.get("client_id"), "client-abc");
      assert.equal(body.get("redirect_uri"), EXPECTED_REDIRECT_URI);
      const verifier = body.get("code_verifier") ?? "";
      assert.equal(
        createHash("sha256").update(verifier, "ascii").digest("base64url"),
        expectedChallenge,
      );

      assert.equal(readiness.status, "connected");
      assert.equal(readiness.refreshTokenStored, true);
      assert.equal(readiness.nextAction, "sync_accounts");

      const tokens = await loadRobinhoodTokens({
        appUserId: auth.user.id,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      assert.equal(tokens?.accessToken, "access-1");
      assert.equal(tokens?.refreshToken, "refresh-1");
    }),
  );
});

test("completeRobinhoodConnect rejects a state mismatch", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      await startRobinhoodConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: async () => jsonResponse({ client_id: "client-abc" }),
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      await assert.rejects(
        completeRobinhoodConnect({
          appUserId: auth.user.id,
          code: "auth-code-1",
          state: "not-the-issued-state",
          env: TEST_ENV,
          fetchImpl: async () => jsonResponse({ access_token: "nope" }),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) =>
          (error as { code?: string }).code ===
          "robinhood_authorization_not_pending",
      );
    }),
  );
});

test("getRobinhoodAccessToken refreshes an expired access token and rotates stored tokens", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginRobinhoodConnectCustody({
        appUserId: auth.user.id,
        oauthClientId: "client-abc",
        oauthState: "state-1",
        pkceVerifier: "verifier-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeRobinhoodTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        scope: "internal",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const tokenBodies: URLSearchParams[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        assert.equal(String(url), ROBINHOOD_OAUTH_TOKEN_URL);
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        return jsonResponse({
          access_token: "fresh-access",
          refresh_token: "refresh-2",
          expires_in: 3600,
        });
      };

      const accessToken = await getRobinhoodAccessToken({
        appUserId: auth.user.id,
        fetchImpl,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      assert.equal(accessToken, "fresh-access");
      assert.equal(tokenBodies.length, 1);
      assert.equal(tokenBodies[0]!.get("grant_type"), "refresh_token");
      assert.equal(tokenBodies[0]!.get("refresh_token"), "refresh-1");
      assert.equal(tokenBodies[0]!.get("client_id"), "client-abc");

      const tokens = await loadRobinhoodTokens({
        appUserId: auth.user.id,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      assert.equal(tokens?.accessToken, "fresh-access");
      assert.equal(tokens?.refreshToken, "refresh-2");
    }),
  );
});
