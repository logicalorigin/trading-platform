import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  deriveSnapTradeUserId,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";
import { generateSnapTradeConnectionPortal } from "./snaptrade-connection-portal";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64url");

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

test("SnapTrade Connection Portal generation requires a registered SnapTrade user", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      let called = false;

      await assert.rejects(
        generateSnapTradeConnectionPortal({
          appUserId: auth.user.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          fetchImpl: async () => {
            called = true;
            throw new Error("fetch should not run");
          },
        }),
        /SnapTrade user is not registered/,
      );
      assert.equal(called, false);
    }),
  );
});

test("SnapTrade Connection Portal generation signs the login request and returns sanitized portal metadata", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-07-01T18:45:00.000Z"),
      });
      const requestedUrls: string[] = [];
      const requestedBodies: string[] = [];
      const requestedSignatures: string[] = [];

      const result = await generateSnapTradeConnectionPortal({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        now: new Date("2026-07-01T19:00:00.000Z"),
        encryptionKey: TEST_ENCRYPTION_KEY,
        input: {
          broker: "INTERACTIVE-BROKERS-FLEX",
          connectionType: "trade-if-available",
          darkMode: true,
        },
        fetchImpl: async (url, init) => {
          requestedUrls.push(String(url));
          requestedBodies.push(String(init?.body ?? ""));
          requestedSignatures.push(
            new Headers(init?.headers).get("Signature") ?? "",
          );
          assert.equal(init?.method, "POST");
          assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
          return new Response(
            JSON.stringify({
              redirectURI:
                "https://app.snaptrade.com/snapTrade/redeemToken?token=portal-token&sessionId=session-123",
              sessionId: "session-123",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.equal(requestedUrls.length, 1);
      const requestUrl = new URL(requestedUrls[0] ?? "");
      assert.equal(requestUrl.origin, "https://api.snaptrade.com");
      assert.equal(requestUrl.pathname, "/api/v1/snapTrade/login");
      assert.equal(requestUrl.searchParams.get("clientId"), "client-123");
      assert.equal(requestUrl.searchParams.get("userId"), snapTradeUserId);
      assert.equal(
        requestUrl.searchParams.get("userSecret"),
        "snaptrade-user-secret",
      );
      assert.equal(requestUrl.searchParams.get("timestamp"), "1782932400");
      assert.doesNotMatch(requestedUrls[0] ?? "", /consumer-secret/);
      assert.equal(requestedSignatures.length, 1);
      assert.ok((requestedSignatures[0] ?? "").length > 20);
      assert.deepEqual(JSON.parse(requestedBodies[0] ?? "{}"), {
        broker: "INTERACTIVE-BROKERS-FLEX",
        connectionType: "trade-if-available",
        connectionPortalVersion: "v4",
        darkMode: true,
        showCloseButton: true,
      });

      assert.deepEqual(result, {
        provider: "snaptrade",
        redirectUri:
          "https://app.snaptrade.com/snapTrade/redeemToken?token=portal-token&sessionId=session-123",
        sessionId: "session-123",
        expiresAt: "2026-07-01T19:05:00.000Z",
        requestedConnectionType: "trade-if-available",
        connectionPortalVersion: "v4",
        broker: "INTERACTIVE-BROKERS-FLEX",
        reconnect: null,
      });
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|pyrus-/,
      );
    }),
  );
});

test("SnapTrade Connection Portal failures are sanitized", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      await assert.rejects(
        generateSnapTradeConnectionPortal({
          appUserId: auth.user.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                message: "bad snaptrade-user-secret for consumer-secret",
              }),
              { status: 403 },
            ),
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 502);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_connection_portal_failed",
          );
          assert.doesNotMatch(
            String((error as Error).message),
            /snaptrade-user-secret|consumer-secret|client-123|pyrus-/,
          );
          return true;
        },
      );
    }),
  );
});
