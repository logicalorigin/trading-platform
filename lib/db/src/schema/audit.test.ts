import assert from "node:assert/strict";
import test from "node:test";

import { withTestDb } from "../testing";

const USER_ID = "00000000-0000-4000-8000-000000000001";

test("audit payloads stay object-shaped and bounded in generated test DDL", async () => {
  await withTestDb(async ({ client }) => {
    await client.exec(`
      INSERT INTO users (id, email)
      VALUES ('${USER_ID}', 'audit-constraints@example.com')
    `);

    await assert.rejects(
      client.exec(`
        INSERT INTO audit_events (app_user_id, event_type, payload)
        VALUES ('${USER_ID}', 'invalid_array', '[]'::jsonb)
      `),
      /audit_events_payload_object_chk/,
    );
    await assert.rejects(
      client.exec(`
        INSERT INTO audit_events (app_user_id, event_type, payload)
        VALUES (
          '${USER_ID}',
          'oversized_object',
          jsonb_build_object('value', repeat('x', 8192))
        )
      `),
      /audit_events_payload_size_chk/,
    );

    await client.exec(`
      INSERT INTO audit_events (app_user_id, event_type, payload)
      VALUES ('${USER_ID}', 'valid_object', '{"safe":true}'::jsonb)
    `);
  });
});
