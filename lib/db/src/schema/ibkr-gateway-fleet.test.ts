import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import { ibkrGatewayHostsTable, ibkrGatewaySessionsTable } from "./broker";

const fleetMigrationSource = readFileSync(
  new URL("../../migrations/20260716_ibkr_gateway_fleet.sql", import.meta.url),
  "utf8",
);
const loopbackOriginMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260716_ibkr_gateway_loopback_control_origin.sql",
    import.meta.url,
  ),
  "utf8",
);
const controlFencingMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260716_ibkr_gateway_session_control_fencing.sql",
    import.meta.url,
  ),
  "utf8",
);
const capsuleLeaseMigrationSource = readFileSync(
  new URL(
    "../../migrations/20260717_ibkr_gateway_capsule_lease_deadlines.sql",
    import.meta.url,
  ),
  "utf8",
);
const prerequisiteMigrationSource = `${fleetMigrationSource}\n${loopbackOriginMigrationSource}`;
const migrationSource = `${prerequisiteMigrationSource}\n${controlFencingMigrationSource}\n${capsuleLeaseMigrationSource}`;
const schemaSource = readFileSync(
  new URL("./broker.ts", import.meta.url),
  "utf8",
);

const OWNER_A = "00000000-0000-4000-8000-000000000001";
const OWNER_B = "00000000-0000-4000-8000-000000000002";
const CONNECTION_A = "00000000-0000-4000-8000-000000000003";
const CONNECTION_B = "00000000-0000-4000-8000-000000000004";
const HOST_A = "00000000-0000-4000-8000-000000000005";
const HOST_B = "00000000-0000-4000-8000-000000000006";
const HOLDER_A = "00000000-0000-4000-8000-000000000007";
const HOLDER_B = "00000000-0000-4000-8000-000000000008";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const DIGEST_A = "c".repeat(64);
const DIGEST_B = "d".repeat(64);

let client: PGlite;
let upgradedPlacedBefore: Record<string, unknown>;
let upgradedPlacedAfter: Record<string, unknown>;
let upgradedUnplacedBefore: Record<string, unknown>;
let upgradedUnplacedAfter: Record<string, unknown>;
let controlMigrationStartedAtMs = 0;
let controlMigrationDeadlineMs = 0;

async function resetFixtures(): Promise<void> {
  await client.exec(`
    DELETE FROM ibkr_gateway_sessions;
    DELETE FROM ibkr_gateway_hosts;
    DELETE FROM broker_connections;

    INSERT INTO broker_connections (
      id,
      app_user_id,
      broker_provider,
      connection_type
    ) VALUES
      ('${CONNECTION_A}', '${OWNER_A}', 'ibkr', 'broker'),
      ('${CONNECTION_B}', '${OWNER_B}', 'ibkr', 'broker');

    INSERT INTO ibkr_gateway_hosts (
      id,
      workload_identity_digest,
      control_origin,
      image_digest,
      runtime_spec_digest,
      runtime_attestation_digest,
      failure_domain,
      measured_slot_capacity,
      admission_slot_capacity,
      status,
      last_heartbeat_at,
      heartbeat_expires_at
    ) VALUES
      (
        '${HOST_A}',
        '${DIGEST_A}',
        'https://host-a.internal.invalid',
        '${SHA_A}',
        '${SHA_A}',
        '${SHA_A}',
        'synthetic-a',
        2,
        2,
        'active',
        now(),
        now() + interval '30 seconds'
      ),
      (
        '${HOST_B}',
        '${DIGEST_B}',
        'https://host-b.internal.invalid',
        '${SHA_B}',
        '${SHA_B}',
        '${SHA_B}',
        'synthetic-b',
        1,
        1,
        'active',
        now(),
        now() + interval '30 seconds'
      );
  `);
}

before(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TYPE broker_provider AS ENUM ('ibkr', 'snaptrade');
    CREATE TYPE connection_type AS ENUM ('broker', 'market_data');
    CREATE TABLE broker_connections (
      id uuid PRIMARY KEY,
      app_user_id uuid,
      broker_provider broker_provider,
      connection_type connection_type
    );
    ${prerequisiteMigrationSource}
  `);
  await resetFixtures();
  await client.exec(`
    INSERT INTO ibkr_gateway_sessions (
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state,
      host_id,
      slot_number,
      lease_holder_id,
      lease_expires_at
    ) VALUES (
      '${OWNER_A}',
      '${CONNECTION_A}',
      7,
      'authenticated',
      '${HOST_A}',
      2,
      '${HOLDER_A}',
      now() + interval '30 seconds'
    );
    INSERT INTO ibkr_gateway_sessions (
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state
    ) VALUES ('${OWNER_B}', '${CONNECTION_B}', 4, 'released');
  `);
  const beforeRows = await client.query<Record<string, unknown>>(`
    SELECT
      id,
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state,
      host_id,
      slot_number,
      lease_holder_id,
      lease_expires_at
    FROM ibkr_gateway_sessions
    ORDER BY broker_connection_id
  `);
  upgradedPlacedBefore = beforeRows.rows[0]!;
  upgradedUnplacedBefore = beforeRows.rows[1]!;
  const databaseClock = await client.query<{ at_ms: number }>(`
    SELECT (extract(epoch FROM clock_timestamp()) * 1000)::double precision AS at_ms
  `);
  controlMigrationStartedAtMs = Number(databaseClock.rows[0]!.at_ms);
  await client.exec(
    controlFencingMigrationSource.replace(
      "BEGIN;",
      "BEGIN;\nSELECT now();\nSELECT pg_sleep(2);",
    ),
  );
  await client.exec(capsuleLeaseMigrationSource);
  const storedDeadline = await client.query<{ deadline_ms: number }>(`
    SELECT
      (extract(epoch FROM replacement_deadline_at) * 1000)::double precision AS deadline_ms
    FROM ibkr_gateway_sessions
    WHERE broker_connection_id = '${CONNECTION_A}'
  `);
  controlMigrationDeadlineMs = Number(storedDeadline.rows[0]?.deadline_ms);
  const afterRows = await client.query<Record<string, unknown>>(`
    SELECT
      id,
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state,
      host_id,
      slot_number,
      lease_holder_id,
      lease_expires_at,
      control_attempt_id,
      control_acknowledged_at,
      replacement_deadline_at
    FROM ibkr_gateway_sessions
    ORDER BY broker_connection_id
  `);
  upgradedPlacedAfter = afterRows.rows[0]!;
  upgradedUnplacedAfter = afterRows.rows[1]!;
});

after(async () => {
  await client.close();
});

beforeEach(async () => {
  await resetFixtures();
});

test("control-fencing migration preserves session state and fences only placed rows", () => {
  const {
    control_attempt_id: placedAttemptId,
    control_acknowledged_at: placedAcknowledgedAt,
    replacement_deadline_at: placedDeadline,
    ...placedAfter
  } = upgradedPlacedAfter;
  assert.deepEqual(placedAfter, upgradedPlacedBefore);
  assert.equal(placedAttemptId, null);
  assert.equal(placedAcknowledgedAt, null);
  assert.ok(placedDeadline);
  assert.ok(Number.isFinite(controlMigrationDeadlineMs));
  assert.ok(
    controlMigrationDeadlineMs >= controlMigrationStartedAtMs + 156_000,
    JSON.stringify({ controlMigrationDeadlineMs, controlMigrationStartedAtMs }),
  );

  const {
    control_attempt_id: unplacedAttemptId,
    control_acknowledged_at: unplacedAcknowledgedAt,
    replacement_deadline_at: unplacedDeadline,
    ...unplacedAfter
  } = upgradedUnplacedAfter;
  assert.deepEqual(unplacedAfter, upgradedUnplacedBefore);
  assert.equal(unplacedAttemptId, null);
  assert.equal(unplacedAcknowledgedAt, null);
  assert.equal(unplacedDeadline, null);
});

test("host registration is fail-closed and stores only identity, attestation, capacity, and health state", () => {
  const columns = getTableConfig(ibkrGatewayHostsTable).columns.map(
    (column) => column.name,
  );

  assert.deepEqual(columns, [
    "id",
    "workload_identity_digest",
    "control_origin",
    "image_digest",
    "runtime_spec_digest",
    "runtime_attestation_digest",
    "capsule_lease_protocol_version",
    "failure_domain",
    "measured_slot_capacity",
    "admission_slot_capacity",
    "status",
    "last_heartbeat_at",
    "heartbeat_expires_at",
    "created_at",
    "updated_at",
  ]);
  assert.doesNotMatch(columns.join(" "), /token|secret|cookie|credential/i);
});

test("host capacity cannot exceed measured density or the twenty-connection fleet ceiling", async () => {
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET admission_slot_capacity = measured_slot_capacity + 1
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_capacity_chk/,
  );
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET measured_slot_capacity = 21,
          admission_slot_capacity = 21
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_capacity_chk/,
  );
});

test("workload identity and runtime attestations are syntactically constrained and immutable", async () => {
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET workload_identity_digest = 'plaintext-bearer-token'
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_workload_identity_digest_chk|ibkr_gateway_hosts_attestation_immutable/,
  );
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET image_digest = '${SHA_B}'
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_attestation_immutable/,
  );
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET runtime_spec_digest = '${SHA_B}'
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_attestation_immutable/,
  );
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_hosts
      SET capsule_lease_protocol_version = 1
      WHERE id = '${HOST_A}'
    `),
    /ibkr_gateway_hosts_attestation_immutable/,
  );
});

test("session placement is owner-bound, all-or-none, and unique per host slot", async () => {
  await assert.rejects(
    client.exec(`
      INSERT INTO ibkr_gateway_sessions (app_user_id, broker_connection_id)
      VALUES ('${OWNER_A}', '${CONNECTION_B}')
    `),
    /ibkr_gateway_sessions_connection_owner_fk/,
  );
  await assert.rejects(
    client.exec(`
      INSERT INTO ibkr_gateway_sessions (
        app_user_id,
        broker_connection_id,
        host_id,
        slot_number,
        replacement_deadline_at
      ) VALUES (
        '${OWNER_A}',
        '${CONNECTION_A}',
        '${HOST_A}',
        1,
        now() + interval '155 seconds'
      )
    `),
    /ibkr_gateway_sessions_placement_lease_chk/,
  );

  await client.exec(`
    INSERT INTO ibkr_gateway_sessions (
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state,
      host_id,
      slot_number,
      lease_holder_id,
      lease_expires_at,
      replacement_deadline_at
    ) VALUES (
      '${OWNER_A}',
      '${CONNECTION_A}',
      1,
      'provisioning',
      '${HOST_A}',
      1,
      '${HOLDER_A}',
      now() + interval '30 seconds',
      now() + interval '155 seconds'
    )
  `);
  await assert.rejects(
    client.exec(`
      INSERT INTO ibkr_gateway_sessions (
        app_user_id,
        broker_connection_id,
        generation,
        lifecycle_state,
        host_id,
        slot_number,
        lease_holder_id,
        lease_expires_at,
        replacement_deadline_at
      ) VALUES (
        '${OWNER_B}',
        '${CONNECTION_B}',
        1,
        'provisioning',
        '${HOST_A}',
        1,
        '${HOLDER_B}',
        now() + interval '30 seconds',
        now() + interval '155 seconds'
      )
    `),
    /ibkr_gateway_sessions_host_slot_key/,
  );
});

test("placed sessions require a replacement fence and exact control acknowledgement", async () => {
  await assert.rejects(
    client.exec(`
      INSERT INTO ibkr_gateway_sessions (
        app_user_id,
        broker_connection_id,
        generation,
        lifecycle_state,
        host_id,
        slot_number,
        lease_holder_id,
        lease_expires_at
      ) VALUES (
        '${OWNER_A}',
        '${CONNECTION_A}',
        1,
        'provisioning',
        '${HOST_A}',
        1,
        '${HOLDER_A}',
        now() + interval '30 seconds'
      )
    `),
    /ibkr_gateway_sessions_control_fencing_chk/,
  );
  await client.exec(`
    INSERT INTO ibkr_gateway_sessions (
      app_user_id,
      broker_connection_id,
      generation,
      lifecycle_state,
      host_id,
      slot_number,
      lease_holder_id,
      lease_expires_at,
      replacement_deadline_at
    ) VALUES (
      '${OWNER_A}',
      '${CONNECTION_A}',
      1,
      'provisioning',
      '${HOST_A}',
      1,
      '${HOLDER_A}',
      now() + interval '30 seconds',
      now() + interval '31 seconds'
    )
  `);
  await assert.rejects(
    client.exec(`
      UPDATE ibkr_gateway_sessions
      SET control_acknowledged_at = now()
      WHERE broker_connection_id = '${CONNECTION_A}'
    `),
    /ibkr_gateway_sessions_control_fencing_chk/,
  );
});

test("session placement carries the physical host and slot but no reusable network target", () => {
  const columns = getTableConfig(ibkrGatewaySessionsTable).columns.map(
    (column) => column.name,
  );

  assert.deepEqual(columns, [
    "id",
    "app_user_id",
    "broker_connection_id",
    "broker_provider",
    "connection_type",
    "generation",
    "lifecycle_state",
    "host_id",
    "slot_number",
    "lease_holder_id",
    "lease_expires_at",
    "control_attempt_id",
    "control_acknowledged_at",
    "replacement_deadline_at",
    "last_activity_at",
    "created_at",
    "updated_at",
  ]);
  assert.doesNotMatch(
    columns.join(" "),
    /target|endpoint|port|token|cookie|credential/i,
  );
});

test("migration and Drizzle schema retain the same named fleet safety constraints", () => {
  for (const name of [
    "broker_connections_id_app_user_id_key",
    "broker_connections_ibkr_identity_key",
    "ibkr_gateway_hosts_workload_identity_digest_key",
    "ibkr_gateway_hosts_workload_identity_digest_chk",
    "ibkr_gateway_hosts_digest_chk",
    "ibkr_gateway_hosts_capacity_chk",
    "ibkr_gateway_hosts_capsule_lease_protocol_version_chk",
    "ibkr_gateway_hosts_status_chk",
    "ibkr_gateway_hosts_heartbeat_chk",
    "ibkr_gateway_hosts_control_origin_chk",
    "ibkr_gateway_sessions_broker_connection_id_key",
    "ibkr_gateway_sessions_host_slot_key",
    "ibkr_gateway_sessions_generation_nonnegative_chk",
    "ibkr_gateway_sessions_ibkr_identity_chk",
    "ibkr_gateway_sessions_lifecycle_state_chk",
    "ibkr_gateway_sessions_placement_lease_chk",
    "ibkr_gateway_sessions_control_fencing_chk",
    "ibkr_gateway_sessions_slot_number_chk",
    "ibkr_gateway_sessions_connection_owner_fk",
    "ibkr_gateway_sessions_connection_identity_fk",
    "ibkr_gateway_sessions_host_fk",
  ]) {
    assert.match(schemaSource, new RegExp(name));
    assert.match(migrationSource, new RegExp(name));
  }
  assert.match(migrationSource, /ibkr_gateway_hosts_attestation_immutable/);
});
