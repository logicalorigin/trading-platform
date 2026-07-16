import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, before, beforeEach, test } from "node:test";

import { PGlite } from "@electric-sql/pglite";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  ibkrGatewayHostsTable,
  ibkrGatewaySessionsTable,
} from "./broker";

const migrationSource = readFileSync(
  new URL(
    "../../migrations/20260716_ibkr_gateway_fleet.sql",
    import.meta.url,
  ),
  "utf8",
);
const schemaSource = readFileSync(new URL("./broker.ts", import.meta.url), "utf8");

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
    ${migrationSource}
  `);
});

after(async () => {
  await client.close();
});

beforeEach(async () => {
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
        slot_number
      ) VALUES ('${OWNER_A}', '${CONNECTION_A}', '${HOST_A}', 1)
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
        lease_expires_at
      ) VALUES (
        '${OWNER_B}',
        '${CONNECTION_B}',
        1,
        'provisioning',
        '${HOST_A}',
        1,
        '${HOLDER_B}',
        now() + interval '30 seconds'
      )
    `),
    /ibkr_gateway_sessions_host_slot_key/,
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
    "last_activity_at",
    "created_at",
    "updated_at",
  ]);
  assert.doesNotMatch(columns.join(" "), /target|endpoint|port|token|cookie|credential/i);
});

test("migration and Drizzle schema retain the same named fleet safety constraints", () => {
  for (const name of [
    "broker_connections_id_app_user_id_key",
    "broker_connections_ibkr_identity_key",
    "ibkr_gateway_hosts_workload_identity_digest_key",
    "ibkr_gateway_hosts_workload_identity_digest_chk",
    "ibkr_gateway_hosts_digest_chk",
    "ibkr_gateway_hosts_capacity_chk",
    "ibkr_gateway_hosts_status_chk",
    "ibkr_gateway_hosts_heartbeat_chk",
    "ibkr_gateway_hosts_control_origin_chk",
    "ibkr_gateway_sessions_broker_connection_id_key",
    "ibkr_gateway_sessions_host_slot_key",
    "ibkr_gateway_sessions_generation_nonnegative_chk",
    "ibkr_gateway_sessions_ibkr_identity_chk",
    "ibkr_gateway_sessions_lifecycle_state_chk",
    "ibkr_gateway_sessions_placement_lease_chk",
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
