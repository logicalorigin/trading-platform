import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import { snapTradeUserCredentialsTable, usersTable } from "@workspace/db/schema";
import { withTestDb } from "@workspace/db/testing";
import { bootstrapInitialUser } from "./auth";
import {
  deriveSnapTradeUserId,
  loadSnapTradeUserCredential,
  readSnapTradeUserReadiness,
  recordSnapTradeUserCredential,
} from "./snaptrade-user-custody";

const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");

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

test("SnapTrade user id is derived from immutable app user id without email", () => {
  const derived = deriveSnapTradeUserId(
    "123e4567-e89b-12d3-a456-426614174000",
  );

  assert.equal(derived, "pyrus-123e4567-e89b-12d3-a456-426614174000");
  assert.doesNotMatch(derived, /@|example\.com/i);
});

test("SnapTrade user readiness is absent until a credential is recorded", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      const readiness = await readSnapTradeUserReadiness(auth.user.id);

      assert.deepEqual(readiness, {
        registered: false,
        status: "not_registered",
        snapTradeUserIdPresent: false,
        userSecretStored: false,
        registeredAt: null,
        disabledAt: null,
        nextAction: "register_snaptrade_user",
      });
    }),
  );
});

test("SnapTrade user credential is encrypted at rest and readable only internally", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });
      const snapTradeUserId = deriveSnapTradeUserId(auth.user.id);

      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId,
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
        now: new Date("2026-06-26T23:45:00.000Z"),
      });

      const [stored] = await db
        .select()
        .from(snapTradeUserCredentialsTable)
        .where(eq(snapTradeUserCredentialsTable.appUserId, auth.user.id));
      assert.ok(stored);
      assert.equal(stored.snapTradeUserId, snapTradeUserId);
      assert.notEqual(stored.userSecretCiphertext, "snaptrade-user-secret");
      assert.doesNotMatch(stored.userSecretCiphertext, /snaptrade-user-secret/);

      const readiness = await readSnapTradeUserReadiness(auth.user.id);
      assert.deepEqual(readiness, {
        registered: true,
        status: "registered",
        snapTradeUserIdPresent: true,
        userSecretStored: true,
        registeredAt: "2026-06-26T23:45:00.000Z",
        disabledAt: null,
        nextAction: "generate_connection_portal",
      });
      assert.doesNotMatch(JSON.stringify(readiness), /snaptrade-user-secret/);
      assert.doesNotMatch(JSON.stringify(readiness), new RegExp(snapTradeUserId));

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

test("SnapTrade credential storage requires an encryption key", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const auth = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      await assert.rejects(
        () =>
          recordSnapTradeUserCredential({
            appUserId: auth.user.id,
            snapTradeUserId: deriveSnapTradeUserId(auth.user.id),
            userSecret: "snaptrade-user-secret",
            encryptionKey: "",
          }),
        /Credential encryption key is not configured/,
      );
    }),
  );
});

test("SnapTrade credential custody is one active record per app user", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const auth = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, auth.user.id));
      assert.ok(user);

      await recordSnapTradeUserCredential({
        appUserId: auth.user.id,
        snapTradeUserId: deriveSnapTradeUserId(auth.user.id),
        userSecret: "snaptrade-user-secret",
        encryptionKey: TEST_ENCRYPTION_KEY,
      });

      await assert.rejects(
        () =>
          recordSnapTradeUserCredential({
            appUserId: auth.user.id,
            snapTradeUserId: `${deriveSnapTradeUserId(auth.user.id)}-second`,
            userSecret: "second-secret",
            encryptionKey: TEST_ENCRYPTION_KEY,
          }),
        /SnapTrade user is already registered/,
      );
    }),
  );
});
