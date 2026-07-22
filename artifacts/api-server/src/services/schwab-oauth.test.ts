import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  classifySchwabTokenRefreshFailure,
  completeSchwabConnect,
  getSchwabAccessToken,
  startSchwabConnect,
  SCHWAB_OAUTH_AUTHORIZATION_URL,
  SCHWAB_OAUTH_TOKEN_URL,
} from "./schwab-oauth";
import {
  beginSchwabConnectCustody,
  loadSchwabTokens,
  readSchwabUserReadiness,
  storeSchwabTokens,
} from "./schwab-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64url");
const TEST_ENV = {
  SCHWAB_APP_KEY: "app-key-abc",
  SCHWAB_APP_SECRET: "app-secret-xyz",
  SCHWAB_OAUTH_REDIRECT_BASE_URL: "https://pyrus.example",
};
const EXPECTED_REDIRECT_URI =
  "https://pyrus.example/api/broker-execution/schwab/oauth/callback";
const EXPECTED_BASIC_AUTH = `Basic ${Buffer.from(
  "app-key-abc:app-secret-xyz",
).toString("base64")}`;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

function unusedFetch(): typeof fetch {
  return (async () => {
    throw new Error("fetch should not be called");
  }) as typeof fetch;
}

test("classifySchwabTokenRefreshFailure treats invalid_grant as refresh_expired_or_revoked", () => {
  assert.equal(
    classifySchwabTokenRefreshFailure({
      status: 400,
      payload: {
        error: "invalid_grant",
        error_description: "Refresh token is expired or revoked",
      },
    }),
    "refresh_expired_or_revoked",
  );
  assert.equal(
    classifySchwabTokenRefreshFailure({
      status: 502,
      payload: { error: "temporarily_unavailable" },
    }),
    "transient_or_unknown",
  );
});

test("startSchwabConnect builds an authorization URL without any network call", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");

      const started = await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-02T18:00:00.000Z"),
      });

      const url = new URL(started.authorizationUrl);
      assert.equal(
        `${url.origin}${url.pathname}`,
        SCHWAB_OAUTH_AUTHORIZATION_URL,
      );
      assert.equal(url.searchParams.get("client_id"), "app-key-abc");
      assert.equal(url.searchParams.get("redirect_uri"), EXPECTED_REDIRECT_URI);
      assert.equal(url.searchParams.get("response_type"), "code");
      assert.equal(url.searchParams.get("scope"), "api");
      assert.equal(url.searchParams.get("state"), started.state);
      assert.ok(started.state.length > 0);

      const readiness = await readSchwabUserReadiness(auth.user.id);
      assert.equal(readiness.status, "pending");
      assert.equal(readiness.nextAction, "complete_authorization");
      assert.deepEqual(readiness.executionBlockers, []);
    }),
  );
});

test("startSchwabConnect throws 503 when Schwab app credentials are missing", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");

      await assert.rejects(
        startSchwabConnect({
          appUserId: auth.user.id,
          env: {
            SCHWAB_OAUTH_REDIRECT_BASE_URL: "https://pyrus.example",
          },
          fetchImpl: unusedFetch(),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return (
            httpError.statusCode === 503 &&
            httpError.code === "schwab_app_credentials_not_configured"
          );
        },
      );
    }),
  );
});

test("startSchwabConnect throws 503 when no redirect base URL is configured", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");

      await assert.rejects(
        startSchwabConnect({
          appUserId: auth.user.id,
          env: {
            SCHWAB_APP_KEY: "app-key-abc",
            SCHWAB_APP_SECRET: "app-secret-xyz",
          },
          fetchImpl: unusedFetch(),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return (
            httpError.statusCode === 503 &&
            httpError.code === "schwab_redirect_base_url_not_configured"
          );
        },
      );
    }),
  );
});

test("completeSchwabConnect exchanges the code with Basic auth and stores tokens", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      const started = await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const tokenBodies: URLSearchParams[] = [];
      const tokenHeaders: Headers[] = [];
      const completeFetch: typeof fetch = async (url, init) => {
        assert.equal(String(url), SCHWAB_OAUTH_TOKEN_URL);
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        tokenHeaders.push(new Headers(init?.headers));
        return jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 1800,
          scope: "api",
        });
      };

      const readiness = await completeSchwabConnect({
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
      assert.equal(body.get("redirect_uri"), EXPECTED_REDIRECT_URI);
      assert.equal(tokenHeaders[0]!.get("Authorization"), EXPECTED_BASIC_AUTH);

      assert.equal(readiness.status, "connected");
      assert.equal(readiness.refreshTokenStored, true);
      assert.equal(readiness.nextAction, "sync_accounts");
      assert.deepEqual(readiness.executionBlockers, []);
      assert.ok(readiness.refreshTokenExpiresAt);
      const expiresAt = new Date(readiness.refreshTokenExpiresAt!).getTime();
      const expected = now.getTime() + 60_000 + SEVEN_DAYS_MS;
      assert.ok(Math.abs(expiresAt - expected) < 1_000);

      const tokens = await loadSchwabTokens({
        appUserId: auth.user.id,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      assert.equal(tokens?.accessToken, "access-1");
      assert.equal(tokens?.refreshToken, "refresh-1");
    }),
  );
});

test("a delayed Schwab callback cannot overwrite a newer connect attempt", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("delayed-callback@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      const first = await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      let exchangeStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        exchangeStarted = resolve;
      });
      let releaseExchange!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseExchange = resolve;
      });
      const delayedFetch: typeof fetch = async () => {
        exchangeStarted();
        await released;
        return jsonResponse({
          access_token: "old-callback-access",
          refresh_token: "old-callback-refresh",
          expires_in: 1800,
        });
      };

      const completion = completeSchwabConnect({
        appUserId: auth.user.id,
        code: "old-auth-code",
        state: first.state,
        env: TEST_ENV,
        fetchImpl: delayedFetch,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date(now.getTime() + 60_000),
      });
      await started;

      await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date(now.getTime() + 120_000),
      });
      releaseExchange();

      await assert.rejects(completion, (error: unknown) => {
        const httpError = error as { statusCode?: number; code?: string };
        return (
          httpError.statusCode === 409 &&
          httpError.code === "schwab_connection_changed"
        );
      });
      const readiness = await readSchwabUserReadiness(
        auth.user.id,
        new Date(now.getTime() + 120_000),
      );
      assert.equal(readiness.status, "pending");
      assert.equal(readiness.nextAction, "complete_authorization");
    }),
  );
});

test("completeSchwabConnect rejects a state that was never issued", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      await assert.rejects(
        completeSchwabConnect({
          appUserId: auth.user.id,
          code: "auth-code-1",
          state: "not-the-issued-state",
          env: TEST_ENV,
          fetchImpl: unusedFetch(),
          encryptionKey: TEST_ENCRYPTION_KEY,
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return (
            httpError.statusCode === 409 &&
            httpError.code === "schwab_authorization_not_pending"
          );
        },
      );
    }),
  );
});

test("completeSchwabConnect rejects an expired authorization state", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      const started = await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      await assert.rejects(
        completeSchwabConnect({
          appUserId: auth.user.id,
          code: "auth-code-1",
          state: started.state,
          env: TEST_ENV,
          fetchImpl: unusedFetch(),
          encryptionKey: TEST_ENCRYPTION_KEY,
          // 15 minute connect TTL has elapsed.
          now: new Date(now.getTime() + 16 * 60 * 1000),
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return (
            httpError.statusCode === 409 &&
            httpError.code === "schwab_authorization_expired"
          );
        },
      );
    }),
  );
});

test("getSchwabAccessToken returns a fresh cached token without a network call", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "fresh-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const accessToken = await getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      assert.equal(accessToken, "fresh-access");
    }),
  );
});

test("getSchwabAccessToken refreshes an expired access token with Basic auth", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const tokenBodies: URLSearchParams[] = [];
      const tokenHeaders: Headers[] = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        assert.equal(String(url), SCHWAB_OAUTH_TOKEN_URL);
        assert.ok(init?.signal instanceof AbortSignal);
        tokenBodies.push(new URLSearchParams(String(init?.body)));
        tokenHeaders.push(new Headers(init?.headers));
        return jsonResponse({
          access_token: "refreshed-access",
          refresh_token: "refresh-2",
          expires_in: 1800,
        });
      };

      const accessToken = await getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      assert.equal(accessToken, "refreshed-access");
      assert.equal(tokenBodies.length, 1);
      assert.equal(tokenBodies[0]!.get("grant_type"), "refresh_token");
      assert.equal(tokenBodies[0]!.get("refresh_token"), "refresh-1");
      assert.equal(tokenHeaders[0]!.get("Authorization"), EXPECTED_BASIC_AUTH);

      const tokens = await loadSchwabTokens({
        appUserId: auth.user.id,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      assert.equal(tokens?.accessToken, "refreshed-access");
      assert.equal(tokens?.refreshToken, "refresh-2");
    }),
  );
});

test("simultaneous Schwab access-token callers share one refresh", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("singleflight@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      let refreshCalls = 0;
      let refreshStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        refreshStarted = resolve;
      });
      let releaseRefresh!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const fetchImpl: typeof fetch = async () => {
        refreshCalls += 1;
        refreshStarted();
        await released;
        return jsonResponse({
          access_token: "shared-access",
          refresh_token: "refresh-2",
          expires_in: 1800,
        });
      };

      const first = getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      const second = getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await started;
      await new Promise<void>((resolve) => setImmediate(resolve));
      const observedCalls = refreshCalls;
      releaseRefresh();

      assert.deepEqual(await Promise.all([first, second]), [
        "shared-access",
        "shared-access",
      ]);
      assert.equal(observedCalls, 1);
    }),
  );
});

test("a delayed Schwab refresh cannot overwrite a newer connect attempt", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("delayed-refresh@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      let refreshStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        refreshStarted = resolve;
      });
      let releaseRefresh!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const delayedFetch: typeof fetch = async () => {
        refreshStarted();
        await released;
        return jsonResponse({
          access_token: "old-refresh-access",
          refresh_token: "old-refresh-token",
          expires_in: 1800,
        });
      };

      const refresh = getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: delayedFetch,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await started;
      await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date(now.getTime() + 60_000),
      });
      releaseRefresh();

      await assert.rejects(refresh, (error: unknown) => {
        const httpError = error as { statusCode?: number; code?: string };
        return (
          httpError.statusCode === 409 &&
          httpError.code === "schwab_connection_changed"
        );
      });
      const readiness = await readSchwabUserReadiness(
        auth.user.id,
        new Date(now.getTime() + 60_000),
      );
      assert.equal(readiness.status, "pending");
      assert.equal(readiness.nextAction, "complete_authorization");
    }),
  );
});

test("a stale invalid_grant response cannot expire a newer Schwab connect attempt", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("stale-invalid-grant@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      let refreshStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        refreshStarted = resolve;
      });
      let releaseRefresh!: () => void;
      const released = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
      });
      const delayedFetch: typeof fetch = async () => {
        refreshStarted();
        await released;
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "Refresh token expired or revoked",
          },
          400,
        );
      };

      const refresh = getSchwabAccessToken({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: delayedFetch,
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await started;
      await startSchwabConnect({
        appUserId: auth.user.id,
        env: TEST_ENV,
        fetchImpl: unusedFetch(),
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date(now.getTime() + 60_000),
      });
      releaseRefresh();

      await assert.rejects(refresh, (error: unknown) => {
        const httpError = error as { statusCode?: number; code?: string };
        return (
          httpError.statusCode === 409 &&
          httpError.code === "schwab_connection_changed"
        );
      });
      const readiness = await readSchwabUserReadiness(
        auth.user.id,
        new Date(now.getTime() + 60_000),
      );
      assert.equal(readiness.status, "pending");
      assert.equal(readiness.nextAction, "complete_authorization");
    }),
  );
});

test("getSchwabAccessToken throws 409 schwab_reconnect_required when the refresh token has expired", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        // Refresh token wall already passed.
        refreshTokenExpiresAt: new Date(now.getTime() - 1_000),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const readiness = await readSchwabUserReadiness(auth.user.id, now);
      assert.equal(readiness.status, "expired");
      assert.equal(readiness.nextAction, "reconnect");
      assert.deepEqual(readiness.executionBlockers, ["broker_reauth"]);

      await assert.rejects(
        getSchwabAccessToken({
          appUserId: auth.user.id,
          env: TEST_ENV,
          fetchImpl: unusedFetch(),
          encryptionKey: TEST_ENCRYPTION_KEY,
          now,
        }),
        (error: unknown) => {
          const httpError = error as { statusCode?: number; code?: string };
          return (
            httpError.statusCode === 409 &&
            httpError.code === "schwab_reconnect_required"
          );
        },
      );
    }),
  );
});

test("getSchwabAccessToken persists reauth state when Schwab rejects refresh with invalid_grant", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "stale-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() - 1_000),
        refreshTokenExpiresAt: new Date(now.getTime() + SEVEN_DAYS_MS),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const fetchImpl: typeof fetch = async () =>
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "Refresh token expired or revoked",
          },
          400,
        );

      await assert.rejects(
        getSchwabAccessToken({
          appUserId: auth.user.id,
          env: TEST_ENV,
          fetchImpl,
          encryptionKey: TEST_ENCRYPTION_KEY,
          now,
        }),
        (error: unknown) => {
          const httpError = error as {
            statusCode?: number;
            code?: string;
            data?: { reason?: string };
          };
          return (
            httpError.statusCode === 409 &&
            httpError.code === "schwab_reconnect_required" &&
            httpError.data?.reason === "refresh_expired_or_revoked"
          );
        },
      );

      const readiness = await readSchwabUserReadiness(auth.user.id, now);
      assert.equal(readiness.status, "expired");
      assert.equal(readiness.nextAction, "reconnect");
      assert.deepEqual(readiness.executionBlockers, ["broker_reauth"]);
    }),
  );
});

test("readSchwabUserReadiness flags broker_reauth when the refresh token wall is near", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const now = new Date("2026-07-02T18:00:00.000Z");
      await beginSchwabConnectCustody({
        appUserId: auth.user.id,
        oauthState: "state-1",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });
      await storeSchwabTokens({
        appUserId: auth.user.id,
        accessToken: "fresh-access",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: new Date(now.getTime() + 1_800_000),
        refreshTokenExpiresAt: new Date(now.getTime() + 23 * 60 * 60 * 1000),
        scope: "api",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now,
      });

      const readiness = await readSchwabUserReadiness(auth.user.id, now);
      assert.equal(readiness.connected, true);
      assert.equal(readiness.status, "connected");
      assert.equal(readiness.nextAction, "reconnect");
      assert.deepEqual(readiness.executionBlockers, ["broker_reauth"]);
    }),
  );
});
