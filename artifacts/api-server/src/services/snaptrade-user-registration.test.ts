import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import {
  db,
  snapTradeUserCredentialsTable,
} from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  deriveSnapTradeUserId,
  loadSnapTradeUserCredential,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";
import { registerSnapTradeCurrentUser } from "./snaptrade-user-registration";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64url");

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

test("SnapTrade registration requires encryption before calling provider", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      let called = false;

      await assert.rejects(
        registerSnapTradeCurrentUser({
          appUserId: auth.user.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: "",
          fetchImpl: async () => {
            called = true;
            throw new Error("fetch should not run");
          },
        }),
        /Credential encryption key is not configured/,
      );
      assert.equal(called, false);
    }),
  );
});

test("SnapTrade registration stores returned user secret encrypted at rest", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);
      const requestedUrls: string[] = [];
      const requestedBodies: string[] = [];
      const requestedSignatures: string[] = [];

      const result = await registerSnapTradeCurrentUser({
        appUserId: auth.user.id,
        env: {
          SNAPTRADE_CLIENTID: "client-123",
          SNAPTRADE_API_KEY: "consumer-secret",
        },
        now: new Date("2026-06-27T00:15:00.000Z"),
        encryptionKey: TEST_ENCRYPTION_KEY,
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
              userId: snapTradeUserId,
              userSecret: "snaptrade-user-secret",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      });

      assert.equal(requestedUrls.length, 1);
      assert.match(
        requestedUrls[0] ?? "",
        /^https:\/\/api\.snaptrade\.com\/api\/v1\/snapTrade\/registerUser\?/,
      );
      assert.doesNotMatch(requestedUrls[0] ?? "", /consumer-secret/);
      assert.equal(requestedSignatures.length, 1);
      assert.ok((requestedSignatures[0] ?? "").length > 20);
      assert.deepEqual(JSON.parse(requestedBodies[0] ?? "{}"), {
        userId: snapTradeUserId,
      });

      assert.equal(result.provider, "snaptrade");
      assert.equal(result.created, true);
      assert.deepEqual(result.user, {
        registered: true,
        status: "registered",
        snapTradeUserIdPresent: true,
        userSecretStored: true,
        registeredAt: "2026-06-27T00:15:00.000Z",
        disabledAt: null,
        nextAction: "generate_connection_portal",
      });
      assert.doesNotMatch(
        JSON.stringify(result),
        /snaptrade-user-secret|consumer-secret|client-123|pyrus-/,
      );

      const [stored] = await db
        .select()
        .from(snapTradeUserCredentialsTable)
        .where(eq(snapTradeUserCredentialsTable.appUserId, auth.user.id));
      assert.ok(stored);
      assert.notEqual(stored.userSecretCiphertext, "snaptrade-user-secret");
      assert.doesNotMatch(stored.userSecretCiphertext, /snaptrade-user-secret/);

      const credential = await loadSnapTradeUserCredential({
        appUserId: auth.user.id,
        encryptionKey: TEST_ENCRYPTION_KEY,
      });
      assert.deepEqual(credential, {
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
      });
    }),
  );
});

test("SnapTrade registration is idempotent for an already registered app user", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");
      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId: deriveSnapTradeUserId(auth.user.id),
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-06-27T00:20:00.000Z"),
      });

      let called = false;
      const result = await registerSnapTradeCurrentUser({
        appUserId: auth.user.id,
        env: {},
        encryptionKey: "",
        fetchImpl: async () => {
          called = true;
          throw new Error("fetch should not run");
        },
      });

      assert.equal(called, false);
      assert.equal(result.created, false);
      assert.equal(result.user.registered, true);
      assert.equal(result.user.nextAction, "generate_connection_portal");
    }),
  );
});

test("SnapTrade registration failures are sanitized and do not store credentials", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await createUser("owner@example.com");

      await assert.rejects(
        registerSnapTradeCurrentUser({
          appUserId: auth.user.id,
          env: {
            SNAPTRADE_CLIENTID: "client-123",
            SNAPTRADE_API_KEY: "consumer-secret",
          },
          encryptionKey: TEST_ENCRYPTION_KEY,
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                message: "bad consumer-secret for client-123",
                userSecret: "raw-secret",
              }),
              { status: 401 },
            ),
        }),
        (error) => {
          assert.equal((error as { statusCode?: number }).statusCode, 502);
          assert.equal(
            (error as { code?: string }).code,
            "snaptrade_register_user_failed",
          );
          assert.doesNotMatch(String((error as Error).message), /consumer-secret|client-123|raw-secret/);
          return true;
        },
      );

      const stored = await db
        .select()
        .from(snapTradeUserCredentialsTable)
        .where(eq(snapTradeUserCredentialsTable.appUserId, auth.user.id));
      assert.equal(stored.length, 0);
    }),
  );
});
