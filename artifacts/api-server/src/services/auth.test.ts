import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";

import { runWithPostgresDiagnosticContext } from "@workspace/db";
import {
  authSessionsTable,
  usersTable,
} from "@workspace/db/schema";
import { withTestDb, type TestDatabase } from "@workspace/db/testing";
import { requireAuth } from "../routes/auth";
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

function countAuthSessionSelects(testDb: TestDatabase): () => number {
  let count = 0;
  const realSelect = testDb.db.select.bind(testDb.db);
  (testDb.db as unknown as { select: (...args: unknown[]) => unknown }).select =
    (...args: unknown[]) => {
      const builder = realSelect(...(args as [])) as {
        from?: (...fromArgs: unknown[]) => unknown;
      };
      if (typeof builder.from !== "function") return builder;

      const realFrom = builder.from.bind(builder);
      builder.from = (...fromArgs: unknown[]) => {
        if (fromArgs[0] === authSessionsTable) {
          count += 1;
        }
        return realFrom(...fromArgs);
      };
      return builder;
    };
  return () => count;
}

function runAuthLookupRequest<T>(
  requestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runWithPostgresDiagnosticContext(
    {
      requestId,
      method: "GET",
      path: "/api/auth/session",
      route: "GET /api/auth/session",
      routeClass: "test",
      workloadFamily: "test",
    },
    fn,
  );
}

function isAuthRequiredError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { statusCode?: unknown }).statusCode === 401 &&
    (error as { code?: unknown }).code === "auth_required"
  );
}

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

test("request context memoizes duplicate auth session lookups", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async (testDb) => {
      const result = await bootstrapInitialUser({
        email: "owner@example.com",
        displayName: "Owner",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });
      const countSelects = countAuthSessionSelects(testDb);

      await runAuthLookupRequest("auth-memo-positive", async () => {
        const first = await readAuthSessionFromToken(result.sessionToken);
        const second = await readAuthSessionFromToken(result.sessionToken);

        assert.equal(first?.user.id, result.user.id);
        assert.equal(second?.user.id, result.user.id);
      });

      assert.equal(countSelects(), 1);
    }),
  );
});

test("auth session lookup memo does not cross request contexts", async () => {
  await withBootstrapToken(async () =>
    withTestDb(async (testDb) => {
      const result = await bootstrapInitialUser({
        email: "owner@example.com",
        displayName: "Owner",
        password: "correct horse battery staple",
        bootstrapToken: "setup-token",
      });
      const countSelects = countAuthSessionSelects(testDb);

      await runAuthLookupRequest("auth-memo-request-a", async () => {
        assert.equal(
          (await readAuthSessionFromToken(result.sessionToken))?.user.id,
          result.user.id,
        );
      });
      await runAuthLookupRequest("auth-memo-request-b", async () => {
        assert.equal(
          (await readAuthSessionFromToken(result.sessionToken))?.user.id,
          result.user.id,
        );
      });

      assert.equal(countSelects(), 2);
    }),
  );
});

test("request context memoizes missing auth sessions and requireAuth still fails closed", async () => {
  await withTestDb(async (testDb) => {
    const countSelects = countAuthSessionSelects(testDb);
    const invalidToken = "missing-session-token";

    await runAuthLookupRequest("auth-memo-negative", async () => {
      assert.equal(await readAuthSessionFromToken(invalidToken), null);
      await assert.rejects(
        () =>
          requireAuth({
            headers: {
              cookie: `pyrus_session=${encodeURIComponent(invalidToken)}`,
            },
          } as Parameters<typeof requireAuth>[0]),
        isAuthRequiredError,
      );
    });

    assert.equal(countSelects(), 1);
  });
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
