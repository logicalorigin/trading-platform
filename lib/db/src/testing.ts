import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";

import {
  __setDbForTests,
  __setPoolQueryForTests,
  type WorkspaceDatabase,
} from "./index";
import * as schema from "./schema";

/**
 * In-process PGlite-backed test database that mirrors the real `@workspace/db`
 * surface. While a `TestDatabase` is installed, the exported `db` from
 * `@workspace/db` forwards to this PGlite instance, so service readers/writers
 * that import `db` run their REAL queries against it — enabling behavior-equality
 * tests against actual SQL semantics (e.g. `loadStoredMarketBars` reading
 * `bar_cache`).
 */
export type TestDatabase = {
  /** Drizzle client over PGlite, sharing the same `schema` as production. */
  db: WorkspaceDatabase;
  /** Raw PGlite client, for direct DDL/SQL when needed. */
  client: PGlite;
  /** Restores the real `db` and closes the PGlite instance. Idempotent. */
  cleanup: () => Promise<void>;
};

/**
 * Cache of the schema DDL. `generateMigration` diffs an empty snapshot against
 * the full drizzle schema to derive the exact CREATE TABLE / CREATE TYPE / index
 * statements — the DDL is DERIVED from the schema, never hand-maintained, so it
 * cannot drift. Computed once per process; each `createTestDb()` re-applies it
 * to a fresh PGlite.
 */
let schemaDdlPromise: Promise<string[]> | null = null;

async function getSchemaDdl(): Promise<string[]> {
  if (!schemaDdlPromise) {
    schemaDdlPromise = (async () => {
      const empty = generateDrizzleJson({});
      const current = generateDrizzleJson(
        schema as unknown as Record<string, unknown>,
      );
      return generateMigration(empty, current);
    })();
  }
  return schemaDdlPromise;
}

/**
 * Spins up a fresh in-process PGlite database, applies the full `@workspace/db`
 * drizzle schema to it, and installs it as the active `db` so service code that
 * imports `db` from `@workspace/db` transparently reads/writes this instance.
 *
 * Call `cleanup()` (or use {@link withTestDb}) to restore the real `db` and free
 * the PGlite instance.
 */
export async function createTestDb(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzlePglite(client, { schema }) as unknown as WorkspaceDatabase;

  const statements = await getSchemaDdl();
  for (const statement of statements) {
    await client.exec(statement);
  }

  const restore = __setDbForTests(db);
  // Route raw `pool.query(text, values)` callers to the same PGlite instance so
  // services that bypass drizzle (hand-written SQL reads like the shadow
  // maintenance peak lookup) hit the test DB too. Translates the pg call
  // signatures PGlite doesn't share; promise-style calls only (all current
  // pool.query callers are promise-style).
  const restorePool = __setPoolQueryForTests(async (...args: unknown[]) => {
    const first = args[0];
    const second = args[1];
    const text =
      typeof first === "string"
        ? first
        : String((first as { text?: unknown })?.text ?? "");
    const values = Array.isArray(second)
      ? second
      : typeof first === "object" && first !== null
        ? ((first as { values?: unknown[] }).values ?? undefined)
        : undefined;
    const result = await client.query(text, values as never[] | undefined);
    return {
      rows: result.rows,
      rowCount:
        (result as { affectedRows?: number }).affectedRows ??
        result.rows.length,
    };
  });

  let closed = false;
  const cleanup = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    restorePool();
    restore();
    await client.close();
  };

  return { db, client, cleanup };
}

/**
 * Scoped helper: creates a test DB, runs `fn` with it installed as the active
 * `db`, and always restores + closes afterward (even if `fn` throws).
 */
export async function withTestDb<T>(
  fn: (testDb: TestDatabase) => Promise<T>,
): Promise<T> {
  const testDb = await createTestDb();
  try {
    return await fn(testDb);
  } finally {
    await testDb.cleanup();
  }
}
