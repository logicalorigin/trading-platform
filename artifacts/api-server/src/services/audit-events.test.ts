import assert from "node:assert/strict";
import test from "node:test";

import { auditEventsTable, db, usersTable } from "@workspace/db";
import { withTestDb } from "@workspace/db/testing";
import { eq } from "drizzle-orm";

import { normalizeAuditPayload, recordAuditEvent } from "./audit-events";

async function createUser(): Promise<string> {
  const [user] = await db
    .insert(usersTable)
    .values({
      email: "audit-events@example.com",
      displayName: null,
      passwordHash: "scrypt:v1:test-only",
      role: "member",
    })
    .returning({ id: usersTable.id });
  assert.ok(user);
  return user.id;
}

test("recordAuditEvent writes a normalized audit row", async () => {
  await withTestDb(async () => {
    const appUserId = await createUser();

    await recordAuditEvent({
      appUserId,
      eventType: "auth.login",
      subject: { type: "user", id: appUserId },
      resource: { type: "route", id: "/auth/login" },
      payload: {
        method: "password",
        nested: { at: new Date("2026-07-07T00:00:00.000Z") },
      },
    });

    const rows = await db
      .select()
      .from(auditEventsTable)
      .where(eq(auditEventsTable.appUserId, appUserId));

    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.eventType, "auth.login");
    assert.equal(rows[0]?.subjectType, "user");
    assert.equal(rows[0]?.resourceType, "route");
    assert.deepEqual(rows[0]?.payload, {
      method: "password",
      nested: { at: "2026-07-07T00:00:00.000Z" },
    });
  });
});

test("recordAuditEvent swallows write failures", async () => {
  await withTestDb(async () => {
    await assert.doesNotReject(() =>
      recordAuditEvent({
        appUserId: "00000000-0000-0000-0000-000000000000",
        eventType: "auth.login",
        payload: { cause: "foreign key failure" },
      }),
    );

    const rows = await db.select().from(auditEventsTable);
    assert.equal(rows.length, 0);
  });
});

test("normalizeAuditPayload bounds oversized payloads", () => {
  const payload = normalizeAuditPayload({
    large: "x".repeat(20_000),
  });

  assert.deepEqual(Object.keys(payload), ["large"]);
  assert.match(String(payload.large), /\[truncated\]$/);
  assert.ok(Buffer.byteLength(JSON.stringify(payload), "utf8") < 8_192);
});
