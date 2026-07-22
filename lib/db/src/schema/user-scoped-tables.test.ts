import assert from "node:assert/strict";
import test from "node:test";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "./index";
import { USER_SCOPED_TABLES } from "./user-scoped-tables";

test("every registered user-scoped table has an app_user_id column", () => {
  assert.ok(USER_SCOPED_TABLES.length > 0, "registry must not be empty");
  for (const table of USER_SCOPED_TABLES) {
    const { name, columns } = getTableConfig(table);
    const hasAppUserId = columns.some((column) => column.name === "app_user_id");
    assert.ok(
      hasAppUserId,
      `table "${name}" is registered user-scoped but has no app_user_id column`,
    );
  }
});

test("registers every exported table with an app_user_id column", () => {
  const registered = new Set(
    USER_SCOPED_TABLES.map((table) => getTableConfig(table).name),
  );
  const exportedUserScoped = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const { name, columns } = getTableConfig(value);
    if (columns.some((column) => column.name === "app_user_id")) {
      exportedUserScoped.add(name);
    }
  }

  assert.deepEqual(
    [...registered].sort(),
    [...exportedUserScoped].sort(),
    "USER_SCOPED_TABLES must be reverse-complete for exported app_user_id tables",
  );
});
