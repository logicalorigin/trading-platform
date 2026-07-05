import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import {
  authSessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { withTestDb } from "@workspace/db/testing";
import {
  bootstrapInitialUser,
  createAuthSession,
  loginUser,
  readAuthSessionFromToken,
  validateAuthCsrfToken,
} from "./auth";

const withBootstrapToken = async <T>(fn: () => Promise<T>): Promise<T> => {
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
};

test("bootstrap creates the first user and stores auth secrets hashed", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async ({ db }) => {
      const result = await bootstrapInitialUser({
        email: "Owner@Example.COM ",
        displayName: "Owner",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      assert.equal(result.user.email, "owner@example.com");
      assert.equal(result.user.displayName, "Owner");
      assert.ok(result.sessionToken.length >= 40);
      assert.ok(result.csrfToken.length >= 40);

      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, result.user.id));
      assert.ok(user);
      assert.notEqual(user.passwordHash, "correct horse battery staple");
      assert.ok(user.passwordHash);
      assert.match(user.passwordHash, /^scrypt:v1:/);

      const [session] = await db
        .select()
        .from(authSessionsTable)
        .where(eq(authSessionsTable.userId, result.user.id));
      assert.ok(session);
      assert.notEqual(session.tokenHash, result.sessionToken);
      assert.notEqual(session.csrfTokenHash, result.csrfToken);

      const read = await readAuthSessionFromToken(result.sessionToken);
      assert.equal(read?.user.id, result.user.id);
      assert.equal(validateAuthCsrfToken(read, result.csrfToken), true);
      assert.equal(validateAuthCsrfToken(read, "wrong-token"), false);
    }),
  );
});

test("bootstrap rejects wrong tokens and cannot create a second user", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      await assert.rejects(
        () =>
          bootstrapInitialUser({
            email: "bad@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "wrong-token",
          }),
        /Invalid bootstrap token/,
      );

      await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      await assert.rejects(
        () =>
          bootstrapInitialUser({
            email: "second@example.com",
            password: "correct horse battery staple",
            bootstrapToken: "setup-token",
          }),
        /Bootstrap is already complete/,
      );
    }),
  );
});

test("login verifies password and expired sessions do not authenticate", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async () => {
      const bootstrapped = await bootstrapInitialUser({
        email: "owner@example.com",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });

      await assert.rejects(
        () =>
          loginUser({
            email: "owner@example.com",
            password: "wrong password",
          }),
        /Invalid email or password/,
      );

      const loggedIn = await loginUser({
        email: " OWNER@example.com ",
        password: "correct horse battery staple",
      });
      assert.equal(loggedIn.user.id, bootstrapped.user.id);
      assert.notEqual(loggedIn.sessionToken, bootstrapped.sessionToken);

      const expired = await createAuthSession({
        userId: bootstrapped.user.id,
        expiresAt: new Date(Date.now() - 1_000),
      });
      assert.equal(await readAuthSessionFromToken(expired.sessionToken), null);
    }),
  );
});
