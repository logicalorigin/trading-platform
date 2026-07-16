import { randomUUID } from "node:crypto";

import {
  brokerConnectionsTable,
  db,
  ibkrGatewayHostsTable,
  ibkrGatewaySessionsTable,
  type BrokerConnection,
  type IbkrGatewayHost,
  type IbkrGatewayLifecycleState,
  type IbkrGatewaySession,
} from "@workspace/db";
import {
  and,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const GLOBAL_FLEET_CAPACITY = 20;
const GLOBAL_ADMISSION_LOCK_ID = 1_347_901_778;
const HOST_HEARTBEAT_INTERVAL_SQL = sql`now() + interval '30 seconds'`;
const SESSION_LEASE_INTERVAL_SQL = sql`now() + interval '30 seconds'`;

const uuidSchema = z.string().uuid();
const identityDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const sha256DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const fleetCapacitySchema = z.number().int().min(1).max(GLOBAL_FLEET_CAPACITY);
const environmentModeSchema = z.enum(["shadow", "live"]);
const IBKR_BROKER_CONNECTION_NAME = "Interactive Brokers Bridge";
const ROUTABLE_LIFECYCLE_STATES: IbkrGatewayLifecycleState[] = [
  "provisioning",
  "login_required",
  "verifying",
  "authenticated",
  "degraded",
  "reauth_required",
];
const LIFECYCLE_PREDECESSORS: Partial<
  Record<IbkrGatewayLifecycleState, IbkrGatewayLifecycleState[]>
> = {
  login_required: ["provisioning", "reauth_required", "login_required"],
  verifying: ["login_required", "verifying"],
  authenticated: ["verifying", "authenticated"],
  degraded: ["verifying", "authenticated", "degraded"],
  reauth_required: [
    "verifying",
    "authenticated",
    "degraded",
    "reauth_required",
  ],
  draining: [...ROUTABLE_LIFECYCLE_STATES, "draining"],
  quarantined: ["draining", "quarantined"],
};

const hostRegistrationSchema = z.object({
  hostId: uuidSchema,
  workloadIdentityDigest: identityDigestSchema,
  controlOrigin: z.string().min(1).max(2_048),
  imageDigest: sha256DigestSchema,
  runtimeSpecDigest: sha256DigestSchema,
  runtimeAttestationDigest: sha256DigestSchema,
  failureDomain: z.string().min(1).max(128),
  measuredSlotCapacity: fleetCapacitySchema,
});

const hostApprovalSchema = z.object({
  hostId: uuidSchema,
  workloadIdentityDigest: identityDigestSchema,
  imageDigest: sha256DigestSchema,
  runtimeSpecDigest: sha256DigestSchema,
  runtimeAttestationDigest: sha256DigestSchema,
  admissionSlotCapacity: fleetCapacitySchema,
});

const hostHeartbeatSchema = z.object({
  hostId: uuidSchema,
  verifiedWorkloadIdentityDigest: identityDigestSchema,
  runtimeAttestationDigest: sha256DigestSchema,
});

type IdentityInput = {
  appUserId: string;
  brokerConnectionId: string;
};

export async function ensureIbkrGatewayBrokerConnection(input: {
  appUserId: string;
  mode: "shadow" | "live";
}): Promise<BrokerConnection | null> {
  if (
    !uuidSchema.safeParse(input.appUserId).success ||
    !environmentModeSchema.safeParse(input.mode).success
  ) {
    return null;
  }
  await db
    .insert(brokerConnectionsTable)
    .values({
      appUserId: input.appUserId,
      name: IBKR_BROKER_CONNECTION_NAME,
      connectionType: "broker",
      brokerProvider: "ibkr",
      mode: input.mode,
      status: "configured",
      capabilities: ["accounts", "positions", "orders", "executions"],
      isDefault: true,
    })
    .onConflictDoNothing();
  return readIbkrGatewayBrokerConnection(input);
}

export async function readIbkrGatewayBrokerConnection(input: {
  appUserId: string;
  mode: "shadow" | "live";
}): Promise<BrokerConnection | null> {
  if (
    !uuidSchema.safeParse(input.appUserId).success ||
    !environmentModeSchema.safeParse(input.mode).success
  ) {
    return null;
  }
  const [connection] = await db
    .select()
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
        eq(brokerConnectionsTable.brokerProvider, "ibkr"),
        eq(brokerConnectionsTable.mode, input.mode),
        eq(brokerConnectionsTable.name, IBKR_BROKER_CONNECTION_NAME),
      ),
    )
    .limit(1);
  return connection ?? null;
}

export type IbkrGatewayFence = {
  appUserId: string;
  brokerConnectionId: string;
  generation: number;
  hostId: string;
  leaseHolderId: string;
  sessionId: string;
  slotNumber: number;
};

export type IbkrGatewayLeaseResult =
  | { status: "acquired"; fence: IbkrGatewayFence; expiresAt: Date }
  | { status: "busy" };

export type IbkrGatewayPlacement = {
  controlOrigin: string;
  hostId: string;
  imageDigest: string;
  runtimeSpecDigest: string;
  sessionId: string;
  slotNumber: number;
};

function validIds(...ids: unknown[]): boolean {
  return ids.every((id) => uuidSchema.safeParse(id).success);
}

export async function readIbkrGatewayHost(
  hostId: string,
): Promise<IbkrGatewayHost | null> {
  if (!validIds(hostId)) return null;
  const [host] = await db
    .select()
    .from(ibkrGatewayHostsTable)
    .where(eq(ibkrGatewayHostsTable.id, hostId))
    .limit(1);
  return host ?? null;
}

export async function countActiveIbkrGatewayHostLeases(
  hostId: string,
): Promise<number | null> {
  if (!validIds(hostId)) return null;
  const [result] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(ibkrGatewaySessionsTable)
    .where(
      and(
        eq(ibkrGatewaySessionsTable.hostId, hostId),
        gt(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
      ),
    );
  return result?.count ?? 0;
}

function normalizeControlOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const secureOrigin = url.protocol === "https:";
    const exactLoopbackOrigin =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "[::1]");
    if (
      (!secureOrigin && !exactLoopbackOrigin) ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function eligibleIbkrConnectionWhere(input: IdentityInput) {
  return sql`EXISTS (
    SELECT 1
    FROM ${brokerConnectionsTable}
    WHERE ${brokerConnectionsTable.id} = ${input.brokerConnectionId}
      AND ${brokerConnectionsTable.appUserId} = ${input.appUserId}
      AND ${brokerConnectionsTable.connectionType} = 'broker'
      AND ${brokerConnectionsTable.brokerProvider} = 'ibkr'
  )`;
}

function healthyAssignedHostWhere() {
  return sql`EXISTS (
    SELECT 1
    FROM ${ibkrGatewayHostsTable}
    WHERE ${ibkrGatewayHostsTable.id} = ${ibkrGatewaySessionsTable.hostId}
      AND ${ibkrGatewayHostsTable.status} IN ('active', 'draining')
      AND ${ibkrGatewayHostsTable.heartbeatExpiresAt} > now()
  )`;
}

function toFence(row: IbkrGatewaySession): IbkrGatewayFence | null {
  if (
    !row.hostId ||
    row.slotNumber === null ||
    !row.leaseHolderId ||
    !row.leaseExpiresAt
  ) {
    return null;
  }
  return {
    appUserId: row.appUserId,
    brokerConnectionId: row.brokerConnectionId,
    generation: row.generation,
    hostId: row.hostId,
    leaseHolderId: row.leaseHolderId,
    sessionId: row.id,
    slotNumber: row.slotNumber,
  };
}

function toAcquired(row: IbkrGatewaySession): IbkrGatewayLeaseResult {
  const fence = toFence(row);
  if (!fence || !row.leaseExpiresAt) return { status: "busy" };
  return { status: "acquired", fence, expiresAt: row.leaseExpiresAt };
}

function registrationMatches(
  host: IbkrGatewayHost,
  input: z.infer<typeof hostRegistrationSchema> & { controlOrigin: string },
): boolean {
  return (
    host.id === input.hostId &&
    host.workloadIdentityDigest === input.workloadIdentityDigest &&
    host.controlOrigin === input.controlOrigin &&
    host.imageDigest === input.imageDigest &&
    host.runtimeSpecDigest === input.runtimeSpecDigest &&
    host.runtimeAttestationDigest === input.runtimeAttestationDigest &&
    host.failureDomain === input.failureDomain &&
    host.measuredSlotCapacity === input.measuredSlotCapacity
  );
}

export async function registerIbkrGatewayHost(
  value: z.input<typeof hostRegistrationSchema>,
): Promise<IbkrGatewayHost | null> {
  const parsed = hostRegistrationSchema.safeParse(value);
  if (!parsed.success) return null;
  const controlOrigin = normalizeControlOrigin(parsed.data.controlOrigin);
  if (!controlOrigin) return null;
  const input = { ...parsed.data, controlOrigin };

  await db
    .insert(ibkrGatewayHostsTable)
    .values({
      id: input.hostId,
      workloadIdentityDigest: input.workloadIdentityDigest,
      controlOrigin: input.controlOrigin,
      imageDigest: input.imageDigest,
      runtimeSpecDigest: input.runtimeSpecDigest,
      runtimeAttestationDigest: input.runtimeAttestationDigest,
      failureDomain: input.failureDomain,
      measuredSlotCapacity: input.measuredSlotCapacity,
      admissionSlotCapacity: 1,
      status: "quarantined",
      lastHeartbeatAt: sql`now()`,
      heartbeatExpiresAt: HOST_HEARTBEAT_INTERVAL_SQL,
    })
    .onConflictDoNothing();

  const [host] = await db
    .select()
    .from(ibkrGatewayHostsTable)
    .where(eq(ibkrGatewayHostsTable.id, input.hostId))
    .limit(1);
  return host && registrationMatches(host, input) ? host : null;
}

export async function approveIbkrGatewayHost(
  value: z.input<typeof hostApprovalSchema>,
): Promise<IbkrGatewayHost | null> {
  const parsed = hostApprovalSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  const [approved] = await db
    .update(ibkrGatewayHostsTable)
    .set({
      admissionSlotCapacity: input.admissionSlotCapacity,
      status: "active",
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ibkrGatewayHostsTable.id, input.hostId),
        eq(
          ibkrGatewayHostsTable.workloadIdentityDigest,
          input.workloadIdentityDigest,
        ),
        eq(ibkrGatewayHostsTable.imageDigest, input.imageDigest),
        eq(ibkrGatewayHostsTable.runtimeSpecDigest, input.runtimeSpecDigest),
        eq(
          ibkrGatewayHostsTable.runtimeAttestationDigest,
          input.runtimeAttestationDigest,
        ),
        sql`${ibkrGatewayHostsTable.measuredSlotCapacity} >= ${input.admissionSlotCapacity}`,
        gt(ibkrGatewayHostsTable.heartbeatExpiresAt, sql`now()`),
      ),
    )
    .returning();
  return approved ?? null;
}

export async function heartbeatIbkrGatewayHost(
  value: z.input<typeof hostHeartbeatSchema>,
): Promise<IbkrGatewayHost | null> {
  const parsed = hostHeartbeatSchema.safeParse(value);
  if (!parsed.success) return null;
  const input = parsed.data;
  const [heartbeat] = await db
    .update(ibkrGatewayHostsTable)
    .set({
      lastHeartbeatAt: sql`now()`,
      heartbeatExpiresAt: HOST_HEARTBEAT_INTERVAL_SQL,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ibkrGatewayHostsTable.id, input.hostId),
        eq(
          ibkrGatewayHostsTable.workloadIdentityDigest,
          input.verifiedWorkloadIdentityDigest,
        ),
        eq(
          ibkrGatewayHostsTable.runtimeAttestationDigest,
          input.runtimeAttestationDigest,
        ),
      ),
    )
    .returning();
  return heartbeat ?? null;
}

export async function disableIbkrGatewayHost(
  hostId: string,
  status: "draining" | "quarantined",
): Promise<IbkrGatewayHost | null> {
  if (
    !validIds(hostId) ||
    (status !== "draining" && status !== "quarantined")
  ) {
    return null;
  }
  const [disabled] = await db
    .update(ibkrGatewayHostsTable)
    .set({ status, updatedAt: sql`now()` })
    .where(eq(ibkrGatewayHostsTable.id, hostId))
    .returning();
  return disabled ?? null;
}

export async function ensureIbkrGatewaySessionIdentity(
  input: IdentityInput,
): Promise<IbkrGatewaySession | null> {
  if (!validIds(input.appUserId, input.brokerConnectionId)) return null;
  const [connection] = await db
    .select({ id: brokerConnectionsTable.id })
    .from(brokerConnectionsTable)
    .where(
      and(
        eq(brokerConnectionsTable.id, input.brokerConnectionId),
        eq(brokerConnectionsTable.appUserId, input.appUserId),
        eq(brokerConnectionsTable.connectionType, "broker"),
        eq(brokerConnectionsTable.brokerProvider, "ibkr"),
      ),
    )
    .limit(1);
  if (!connection) return null;

  await db
    .insert(ibkrGatewaySessionsTable)
    .values({
      appUserId: input.appUserId,
      brokerConnectionId: input.brokerConnectionId,
    })
    .onConflictDoNothing({
      target: ibkrGatewaySessionsTable.brokerConnectionId,
    });
  const [identity] = await db
    .select()
    .from(ibkrGatewaySessionsTable)
    .where(
      and(
        eq(ibkrGatewaySessionsTable.appUserId, input.appUserId),
        eq(
          ibkrGatewaySessionsTable.brokerConnectionId,
          input.brokerConnectionId,
        ),
      ),
    )
    .limit(1);
  return identity ?? null;
}

export async function tryAcquireIbkrGatewayLease(
  input: IdentityInput,
): Promise<IbkrGatewayLeaseResult> {
  if (!validIds(input.appUserId, input.brokerConnectionId)) {
    return { status: "busy" };
  }
  const leaseHolderId = randomUUID();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${GLOBAL_ADMISSION_LOCK_ID})`,
    );
    const [candidate] = await tx
      .select()
      .from(ibkrGatewaySessionsTable)
      .where(
        and(
          eq(ibkrGatewaySessionsTable.appUserId, input.appUserId),
          eq(
            ibkrGatewaySessionsTable.brokerConnectionId,
            input.brokerConnectionId,
          ),
          eligibleIbkrConnectionWhere(input),
          lt(ibkrGatewaySessionsTable.generation, POSTGRES_INTEGER_MAX),
          or(
            and(
              isNull(ibkrGatewaySessionsTable.hostId),
              isNull(ibkrGatewaySessionsTable.leaseExpiresAt),
            ),
            lte(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
            sql`NOT ${healthyAssignedHostWhere()}`,
          ),
        ),
      )
      .limit(1)
      .for("update");
    if (!candidate) return { status: "busy" };

    await tx
      .update(ibkrGatewaySessionsTable)
      .set({
        generation: sql`${ibkrGatewaySessionsTable.generation} + 1`,
        lifecycleState: sql`CASE
          WHEN ${healthyAssignedHostWhere()} THEN 'released'
          ELSE 'quarantined'
        END`,
        hostId: null,
        slotNumber: null,
        leaseHolderId: null,
        leaseExpiresAt: null,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          ne(ibkrGatewaySessionsTable.id, candidate.id),
          isNotNull(ibkrGatewaySessionsTable.hostId),
          lt(ibkrGatewaySessionsTable.generation, POSTGRES_INTEGER_MAX),
          or(
            lte(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
            sql`NOT ${healthyAssignedHostWhere()}`,
          ),
        ),
      );

    const [activeCount] = await tx
      .select({ count: sql<number>`count(*)::integer` })
      .from(ibkrGatewaySessionsTable)
      .where(
        and(
          isNotNull(ibkrGatewaySessionsTable.hostId),
          gt(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
          healthyAssignedHostWhere(),
        ),
      );
    if ((activeCount?.count ?? 0) >= GLOBAL_FLEET_CAPACITY) {
      return { status: "busy" };
    }

    const hosts = await tx
      .select()
      .from(ibkrGatewayHostsTable)
      .where(
        and(
          eq(ibkrGatewayHostsTable.status, "active"),
          gt(ibkrGatewayHostsTable.heartbeatExpiresAt, sql`now()`),
        ),
      )
      .orderBy(ibkrGatewayHostsTable.id)
      .for("update");
    if (hosts.length === 0) return { status: "busy" };

    const hostIds = hosts.map((host) => host.id);
    const occupants = await tx
      .select({
        hostId: ibkrGatewaySessionsTable.hostId,
        slotNumber: ibkrGatewaySessionsTable.slotNumber,
      })
      .from(ibkrGatewaySessionsTable)
      .where(
        and(
          inArray(ibkrGatewaySessionsTable.hostId, hostIds),
          ne(ibkrGatewaySessionsTable.id, candidate.id),
          gt(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
        ),
      );
    const occupied = new Set(
      occupants.map((row) => `${row.hostId}:${row.slotNumber}`),
    );
    const orderedHosts = [...hosts].sort((left, right) => {
      const leftUsed = occupants.filter((row) => row.hostId === left.id).length;
      const rightUsed = occupants.filter((row) => row.hostId === right.id).length;
      const utilizationDelta =
        leftUsed / left.admissionSlotCapacity -
        rightUsed / right.admissionSlotCapacity;
      return utilizationDelta || left.id.localeCompare(right.id);
    });
    let placement: { hostId: string; slotNumber: number } | null = null;
    for (const host of orderedHosts) {
      for (
        let slotNumber = 1;
        slotNumber <= host.admissionSlotCapacity;
        slotNumber += 1
      ) {
        if (!occupied.has(`${host.id}:${slotNumber}`)) {
          placement = { hostId: host.id, slotNumber };
          break;
        }
      }
      if (placement) break;
    }
    if (!placement) return { status: "busy" };

    const [acquired] = await tx
      .update(ibkrGatewaySessionsTable)
      .set({
        generation: sql`${ibkrGatewaySessionsTable.generation} + 1`,
        lifecycleState: "provisioning",
        hostId: placement.hostId,
        slotNumber: placement.slotNumber,
        leaseHolderId,
        leaseExpiresAt: SESSION_LEASE_INTERVAL_SQL,
        lastActivityAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(ibkrGatewaySessionsTable.id, candidate.id),
          eq(ibkrGatewaySessionsTable.generation, candidate.generation),
          lt(ibkrGatewaySessionsTable.generation, POSTGRES_INTEGER_MAX),
        ),
      )
      .returning();
    return acquired ? toAcquired(acquired) : { status: "busy" };
  });
}

export function isValidIbkrGatewayFence(
  value: unknown,
): value is IbkrGatewayFence {
  if (!value || typeof value !== "object") return false;
  const fence = value as Partial<IbkrGatewayFence>;
  return (
    validIds(
      fence.sessionId,
      fence.appUserId,
      fence.brokerConnectionId,
      fence.hostId,
      fence.leaseHolderId,
    ) &&
    Number.isSafeInteger(fence.generation) &&
    (fence.generation ?? -1) >= 0 &&
    (fence.generation ?? POSTGRES_INTEGER_MAX + 1) <= POSTGRES_INTEGER_MAX &&
    Number.isSafeInteger(fence.slotNumber) &&
    (fence.slotNumber ?? 0) >= 1 &&
    (fence.slotNumber ?? GLOBAL_FLEET_CAPACITY + 1) <= GLOBAL_FLEET_CAPACITY
  );
}

function exactIbkrGatewayFenceWhere(fence: IbkrGatewayFence) {
  return and(
    eq(ibkrGatewaySessionsTable.id, fence.sessionId),
    eq(ibkrGatewaySessionsTable.appUserId, fence.appUserId),
    eq(
      ibkrGatewaySessionsTable.brokerConnectionId,
      fence.brokerConnectionId,
    ),
    eq(ibkrGatewaySessionsTable.generation, fence.generation),
    eq(ibkrGatewaySessionsTable.hostId, fence.hostId),
    eq(ibkrGatewaySessionsTable.slotNumber, fence.slotNumber),
    eq(ibkrGatewaySessionsTable.leaseHolderId, fence.leaseHolderId),
    eligibleIbkrConnectionWhere(fence),
  );
}

function liveIbkrGatewayFenceWhere(fence: IbkrGatewayFence) {
  return and(
    exactIbkrGatewayFenceWhere(fence),
    gt(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
    healthyAssignedHostWhere(),
  );
}

function cleanupIbkrGatewayFenceWhere(fence: IbkrGatewayFence) {
  return and(
    liveIbkrGatewayFenceWhere(fence),
    inArray(ibkrGatewaySessionsTable.lifecycleState, [
      "draining",
      "quarantined",
    ]),
  );
}

export function currentIbkrGatewayFenceWhere(fence: IbkrGatewayFence) {
  return and(
    liveIbkrGatewayFenceWhere(fence),
    inArray(
      ibkrGatewaySessionsTable.lifecycleState,
      ROUTABLE_LIFECYCLE_STATES,
    ),
  );
}

export async function transitionIbkrGatewayLifecycle(
  fence: IbkrGatewayFence,
  target: IbkrGatewayLifecycleState,
): Promise<boolean> {
  if (!isValidIbkrGatewayFence(fence)) return false;
  const predecessors = LIFECYCLE_PREDECESSORS[target];
  if (!predecessors) return false;
  const exactSafetyTransition =
    target === "draining" || target === "quarantined";
  const [transitioned] = await db
    .update(ibkrGatewaySessionsTable)
    .set({
      lifecycleState: target,
      lastActivityAt: sql`CASE
        WHEN ${ibkrGatewaySessionsTable.lifecycleState} = ${target}
          THEN ${ibkrGatewaySessionsTable.lastActivityAt}
        ELSE now()
      END`,
      updatedAt: sql`CASE
        WHEN ${ibkrGatewaySessionsTable.lifecycleState} = ${target}
          THEN ${ibkrGatewaySessionsTable.updatedAt}
        ELSE now()
      END`,
    })
    .where(
      and(
        exactSafetyTransition
          ? exactIbkrGatewayFenceWhere(fence)
          : currentIbkrGatewayFenceWhere(fence),
        inArray(ibkrGatewaySessionsTable.lifecycleState, predecessors),
      ),
    )
    .returning({ id: ibkrGatewaySessionsTable.id });
  return Boolean(transitioned);
}

export async function assertCurrentIbkrGatewayFence(
  fence: IbkrGatewayFence,
): Promise<boolean> {
  if (!isValidIbkrGatewayFence(fence)) return false;
  const [current] = await db
    .select({ id: ibkrGatewaySessionsTable.id })
    .from(ibkrGatewaySessionsTable)
    .where(currentIbkrGatewayFenceWhere(fence))
    .limit(1);
  return Boolean(current);
}

export async function readCurrentIbkrGatewayFence(
  input: IdentityInput,
): Promise<IbkrGatewayFence | null> {
  if (!validIds(input.appUserId, input.brokerConnectionId)) return null;
  const [current] = await db
    .select()
    .from(ibkrGatewaySessionsTable)
    .where(
      and(
        eq(ibkrGatewaySessionsTable.appUserId, input.appUserId),
        eq(
          ibkrGatewaySessionsTable.brokerConnectionId,
          input.brokerConnectionId,
        ),
        isNotNull(ibkrGatewaySessionsTable.hostId),
        isNotNull(ibkrGatewaySessionsTable.slotNumber),
        isNotNull(ibkrGatewaySessionsTable.leaseHolderId),
        gt(ibkrGatewaySessionsTable.leaseExpiresAt, sql`now()`),
        eligibleIbkrConnectionWhere(input),
        healthyAssignedHostWhere(),
      ),
    )
    .limit(1);
  return current ? toFence(current) : null;
}

export async function resolveCurrentIbkrGatewayPlacement(
  fence: IbkrGatewayFence,
): Promise<IbkrGatewayPlacement | null> {
  if (!isValidIbkrGatewayFence(fence)) return null;
  const [placement] = await db
    .select({
      controlOrigin: ibkrGatewayHostsTable.controlOrigin,
      hostId: ibkrGatewaySessionsTable.hostId,
      imageDigest: ibkrGatewayHostsTable.imageDigest,
      runtimeSpecDigest: ibkrGatewayHostsTable.runtimeSpecDigest,
      sessionId: ibkrGatewaySessionsTable.id,
      slotNumber: ibkrGatewaySessionsTable.slotNumber,
    })
    .from(ibkrGatewaySessionsTable)
    .innerJoin(
      ibkrGatewayHostsTable,
      eq(ibkrGatewayHostsTable.id, ibkrGatewaySessionsTable.hostId),
    )
    .where(currentIbkrGatewayFenceWhere(fence))
    .limit(1);
  if (!placement || !placement.hostId || placement.slotNumber === null) {
    return null;
  }
  return {
    ...placement,
    hostId: placement.hostId,
    slotNumber: placement.slotNumber,
  };
}

export async function resolveIbkrGatewayCleanupPlacement(
  fence: IbkrGatewayFence,
): Promise<IbkrGatewayPlacement | null> {
  if (!isValidIbkrGatewayFence(fence)) return null;
  const [placement] = await db
    .select({
      controlOrigin: ibkrGatewayHostsTable.controlOrigin,
      hostId: ibkrGatewaySessionsTable.hostId,
      imageDigest: ibkrGatewayHostsTable.imageDigest,
      runtimeSpecDigest: ibkrGatewayHostsTable.runtimeSpecDigest,
      sessionId: ibkrGatewaySessionsTable.id,
      slotNumber: ibkrGatewaySessionsTable.slotNumber,
    })
    .from(ibkrGatewaySessionsTable)
    .innerJoin(
      ibkrGatewayHostsTable,
      eq(ibkrGatewayHostsTable.id, ibkrGatewaySessionsTable.hostId),
    )
    .where(cleanupIbkrGatewayFenceWhere(fence))
    .limit(1);
  if (!placement || !placement.hostId || placement.slotNumber === null) {
    return null;
  }
  return {
    ...placement,
    hostId: placement.hostId,
    slotNumber: placement.slotNumber,
  };
}

export async function renewIbkrGatewayLease(
  fence: IbkrGatewayFence,
): Promise<IbkrGatewayFence | null> {
  if (!isValidIbkrGatewayFence(fence)) return null;
  const [renewed] = await db
    .update(ibkrGatewaySessionsTable)
    .set({
      leaseExpiresAt: SESSION_LEASE_INTERVAL_SQL,
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(currentIbkrGatewayFenceWhere(fence))
    .returning();
  return renewed ? toFence(renewed) : null;
}

export async function renewIbkrGatewayCleanupLease(
  fence: IbkrGatewayFence,
): Promise<IbkrGatewayFence | null> {
  if (!isValidIbkrGatewayFence(fence)) return null;
  const [renewed] = await db
    .update(ibkrGatewaySessionsTable)
    .set({
      leaseExpiresAt: SESSION_LEASE_INTERVAL_SQL,
    })
    .where(cleanupIbkrGatewayFenceWhere(fence))
    .returning();
  return renewed ? toFence(renewed) : null;
}

export async function releaseIbkrGatewayLease(
  fence: IbkrGatewayFence,
): Promise<boolean> {
  if (!isValidIbkrGatewayFence(fence)) return false;
  const [released] = await db
    .update(ibkrGatewaySessionsTable)
    .set({
      generation: sql`${ibkrGatewaySessionsTable.generation} + 1`,
      lifecycleState: "released",
      hostId: null,
      slotNumber: null,
      leaseHolderId: null,
      leaseExpiresAt: null,
      lastActivityAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        cleanupIbkrGatewayFenceWhere(fence),
        lt(ibkrGatewaySessionsTable.generation, POSTGRES_INTEGER_MAX),
      ),
    )
    .returning({ id: ibkrGatewaySessionsTable.id });
  return Boolean(released);
}
