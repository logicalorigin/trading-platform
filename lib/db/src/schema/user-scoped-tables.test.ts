import assert from "node:assert/strict";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
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
