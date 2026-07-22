import {
  db,
  executionEventsTable,
  shadowOrdersTable,
  type ExecutionEvent,
} from "@workspace/db";
import {
  and,
  asc,
  eq,
  gte,
  inArray,
  lte,
  not,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";

const EXIT_CLAIM_TTL_MS = 10 * 60 * 1000;
const claimedExits = new Map<string, number>();

const SIGNAL_OPTIONS_ENTRY_EVENT = "signal_options_shadow_entry";
const SIGNAL_OPTIONS_EXIT_EVENT = "signal_options_shadow_exit";
const SIGNAL_OPTIONS_BACKFILL_SOURCE = "signal_options_backfill";
const SIGNAL_OPTIONS_REPLAY_SOURCE = "signal_options_replay";
const SIGNAL_OPTIONS_SHADOW_ACCOUNT_ID = "shadow";
const QUANTITY_EPSILON = 1e-8;
const SIGNAL_OPTIONS_LIFECYCLE_EVENT_SCAN_LIMIT = 1_024;
// ponytail: keep the canonical Unit05 predicate local; promote the existing DB
// trim literal only when its unrelated indexed-SQL callers next need editing.
const javascriptTrimCharactersSql = sql.raw(
  "U&'\\0009\\000A\\000B\\000C\\000D\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\2028\\2029\\202F\\205F\\3000\\FEFF'",
);

type SignalOptionsLifecycleExitFenceLedger = {
  listEvents(input: {
    deploymentId: string;
    symbol: string;
    positionId: string;
    openedAt: Date;
    positionKey: string | null;
    contractTicker: string | null;
    providerContractId: string | null;
    maxOccurredAt: Date;
    maxRows: number;
  }): Promise<ExecutionEvent[]>;
  currentTime?(): Promise<Date>;
  loadEntryOrder?(
    orderId: string,
    linkedEntryId?: string,
  ): Promise<typeof shadowOrdersTable.$inferSelect | null>;
  insertEvent(event: ExecutionEvent): Promise<ExecutionEvent | null>;
};

export type SignalOptionsLifecycleExitFenceResult =
  | { status: "inserted"; event: ExecutionEvent }
  | { status: "duplicate"; event: ExecutionEvent }
  | { status: "busy" | "inactive" | "invalid" | "stale" };

type SignalOptionsLifecycleExitFenceLockedResult = Exclude<
  SignalOptionsLifecycleExitFenceResult,
  { status: "busy" }
>;

export type SignalOptionsLifecycleExitFenceDependencies = {
  withLifecycleLock(
    keys: readonly string[],
    work: (
      ledger: SignalOptionsLifecycleExitFenceLedger,
    ) => Promise<SignalOptionsLifecycleExitFenceLockedResult>,
  ): Promise<
    | { acquired: false }
    | {
        acquired: true;
        result: SignalOptionsLifecycleExitFenceLockedResult;
      }
  >;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finitePositiveNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isoTimestamp(value: unknown): string | null {
  const date = value instanceof Date ? value : new Date(String(value ?? ""));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function lifecyclePosition(payload: Record<string, unknown>) {
  return asRecord(payload.preExitPosition ?? payload.position);
}

type SignalOptionsContractAliases = {
  ticker: string | null;
  providerContractId: string | null;
};

function signalOptionsContractAliases(
  value: unknown,
): SignalOptionsContractAliases {
  const contract = asRecord(value);
  return {
    ticker: nonEmptyString(contract.ticker),
    providerContractId: nonEmptyString(contract.providerContractId),
  };
}

function signalOptionsContractAliasesMatch(
  left: SignalOptionsContractAliases,
  right: SignalOptionsContractAliases,
) {
  return Boolean(
    (left.ticker && right.ticker && left.ticker === right.ticker) ||
      (left.providerContractId &&
        right.providerContractId &&
        left.providerContractId === right.providerContractId),
  );
}

export type SignalOptionsLifecycleIdentity = {
  positionId: string;
  openedAt: string;
  contractKey: string | null;
  contractIdentifier: string | null;
  contractTicker: string | null;
  providerContractId: string | null;
  contractIdentifiers: string[];
  positionKey: string | null;
  candidateId: string | null;
};

function lifecycleIdentity(payload: Record<string, unknown>) {
  const position = lifecyclePosition(payload);
  const metadata = asRecord(payload.metadata);
  const candidate = asRecord(payload.candidate);
  const selectedContract = asRecord(
    payload.selectedContract ?? position.selectedContract,
  );
  const positionId = nonEmptyString(position.id);
  const openedAt = isoTimestamp(position.openedAt);
  if (!positionId || !openedAt) {
    return null;
  }
  const { ticker: contractTicker, providerContractId } =
    signalOptionsContractAliases(selectedContract);
  const contractIdentifiers = Array.from(
    new Set(
      [contractTicker, providerContractId].filter(
        (value): value is string => value != null,
      ),
    ),
  );
  const contractIdentifier = contractIdentifiers[0] ?? null;
  return {
    positionId,
    openedAt,
    contractKey: contractTicker
      ? JSON.stringify(["option-contract", "ticker", contractTicker])
      : providerContractId
        ? JSON.stringify(["option-contract", "provider", providerContractId])
        : null,
    contractIdentifier,
    contractTicker,
    providerContractId,
    contractIdentifiers,
    positionKey:
      nonEmptyString(metadata.positionKey) ??
      nonEmptyString(payload.positionKey) ??
      nonEmptyString(position.positionKey),
    candidateId:
      nonEmptyString(position.candidateId) ??
      nonEmptyString(candidate.id) ??
      nonEmptyString(payload.candidateId),
  };
}

export function signalOptionsLifecycleIdentitiesMatch(
  left: SignalOptionsLifecycleIdentity,
  right: SignalOptionsLifecycleIdentity,
) {
  if (
    left.positionId !== right.positionId ||
    left.openedAt !== right.openedAt
  ) {
    return false;
  }
  if (left.contractIdentifiers.length || right.contractIdentifiers.length) {
    if (!left.contractIdentifiers.length || !right.contractIdentifiers.length) {
      return false;
    }
    return signalOptionsContractAliasesMatch(
      {
        ticker: left.contractTicker,
        providerContractId: left.providerContractId,
      },
      {
        ticker: right.contractTicker,
        providerContractId: right.providerContractId,
      },
    );
  }
  if (left.positionKey || right.positionKey) {
    return Boolean(
      left.positionKey &&
        right.positionKey &&
        left.positionKey === right.positionKey,
    );
  }
  return true;
}

function signalOptionsLifecycleEntryIdentityMatches(
  entry: SignalOptionsLifecycleIdentity,
  lifecycle: SignalOptionsLifecycleIdentity,
) {
  if (
    entry.positionId !== lifecycle.positionId ||
    entry.openedAt !== lifecycle.openedAt
  ) {
    return false;
  }
  if (
    entry.contractIdentifiers.length &&
    (!lifecycle.contractIdentifiers.length ||
      !signalOptionsContractAliasesMatch(
        {
          ticker: entry.contractTicker,
          providerContractId: entry.providerContractId,
        },
        {
          ticker: lifecycle.contractTicker,
          providerContractId: lifecycle.providerContractId,
        },
      ))
  ) {
    return false;
  }
  return !entry.positionKey || entry.positionKey === lifecycle.positionKey;
}

export function isHistoricalSignalOptionsLifecycleEvent(event: {
  payload?: unknown | null;
}) {
  const payload = asRecord(event.payload);
  const metadata = asRecord(payload.metadata);
  const backfill = asRecord(payload.backfill);
  const replay = asRecord(payload.replay);
  const historicalSources = new Set([
    SIGNAL_OPTIONS_BACKFILL_SOURCE,
    SIGNAL_OPTIONS_REPLAY_SOURCE,
  ]);
  return Boolean(
    nonEmptyString(payload.backfillEventKey) ||
      historicalSources.has(nonEmptyString(metadata.runSource) ?? "") ||
      historicalSources.has(nonEmptyString(metadata.sourceType) ?? "") ||
      metadata.runMode === "historical_backfill" ||
      metadata.runMode === "replay" ||
      historicalSources.has(nonEmptyString(backfill.source) ?? "") ||
      historicalSources.has(nonEmptyString(replay.source) ?? ""),
  );
}

export function signalOptionsHistoricalLifecycleEventSql(
  payload: SQLWrapper,
): SQL {
  return sql<boolean>`coalesce((
    (
      jsonb_typeof(${payload}->'backfillEventKey') = 'string'
      and nullif(btrim(${payload}->>'backfillEventKey', ${javascriptTrimCharactersSql}), '') is not null
    )
    or btrim(coalesce(${payload}->'metadata'->>'runSource', ''), ${javascriptTrimCharactersSql}) in (${SIGNAL_OPTIONS_BACKFILL_SOURCE}, ${SIGNAL_OPTIONS_REPLAY_SOURCE})
    or btrim(coalesce(${payload}->'metadata'->>'sourceType', ''), ${javascriptTrimCharactersSql}) in (${SIGNAL_OPTIONS_BACKFILL_SOURCE}, ${SIGNAL_OPTIONS_REPLAY_SOURCE})
    or ${payload}->'metadata'->>'runMode' in ('historical_backfill', 'replay')
    or btrim(coalesce(${payload}->'backfill'->>'source', ''), ${javascriptTrimCharactersSql}) in (${SIGNAL_OPTIONS_BACKFILL_SOURCE}, ${SIGNAL_OPTIONS_REPLAY_SOURCE})
    or btrim(coalesce(${payload}->'replay'->>'source', ''), ${javascriptTrimCharactersSql}) in (${SIGNAL_OPTIONS_BACKFILL_SOURCE}, ${SIGNAL_OPTIONS_REPLAY_SOURCE})
  ), false)`;
}

function quantitiesEqual(left: number, right: number) {
  return Math.abs(left - right) <= QUANTITY_EPSILON;
}

function exitQuantity(payload: Record<string, unknown>): number | null {
  const position = asRecord(payload.position);
  return finitePositiveNumber(
    payload.exitQuantity ??
      payload.soldQuantity ??
      payload.quantity ??
      position.quantity,
  );
}

function preExitQuantity(payload: Record<string, unknown>): number | null {
  const preExitPosition = asRecord(payload.preExitPosition);
  const position = asRecord(payload.position);
  const explicit = finitePositiveNumber(preExitPosition.quantity);
  if (explicit != null) {
    return explicit;
  }
  if (payload.partial !== true) {
    return finitePositiveNumber(position.quantity) ?? exitQuantity(payload);
  }
  const sold = exitQuantity(payload);
  const remaining = finitePositiveNumber(payload.remainingQuantity);
  return sold != null && remaining != null ? sold + remaining : null;
}

function signalOptionsPartialExitActionKey(payload: Record<string, unknown>) {
  if (payload.partial !== true) {
    return null;
  }
  const scaleOutId = nonEmptyString(payload.scaleOutId);
  const signalKey = nonEmptyString(payload.signalKey);
  return scaleOutId || signalKey
    ? JSON.stringify([scaleOutId, signalKey])
    : null;
}

function signalOptionsLifecycleEntryOrderQuantity(
  event: ExecutionEvent,
  identity: SignalOptionsLifecycleIdentity,
  order: typeof shadowOrdersTable.$inferSelect,
): number | null {
  const orderPayload = asRecord(order.payload);
  const orderPosition = asRecord(orderPayload.position);
  const metadata = asRecord(orderPayload.metadata);
  const replay = asRecord(orderPayload.replay);
  const candidate = asRecord(orderPayload.candidate);
  const orderIdentity = lifecycleIdentity(orderPayload);
  const filledQuantity = finitePositiveNumber(order.filledQuantity);
  const requestedQuantity = finitePositiveNumber(order.quantity);
  const mirroredQuantity =
    orderPosition.quantity == null
      ? null
      : finitePositiveNumber(orderPosition.quantity);
  const orderDeploymentId =
    nonEmptyString(metadata.deploymentId) ??
    nonEmptyString(replay.deploymentId) ??
    nonEmptyString(candidate.deploymentId);
  const orderContract = signalOptionsContractAliases(order.optionContract);
  if (
    orderDeploymentId !== event.deploymentId ||
    order.symbol !== event.symbol ||
    isoTimestamp(order.placedAt) !== identity.openedAt ||
    !orderIdentity ||
    orderIdentity.positionId !== identity.positionId ||
    orderIdentity.openedAt !== identity.openedAt ||
    !identity.positionKey ||
    (orderIdentity.positionKey != null &&
      orderIdentity.positionKey !== identity.positionKey) ||
    !signalOptionsLifecycleEntryIdentityMatches(orderIdentity, identity) ||
    !signalOptionsContractAliasesMatch(orderContract, {
      ticker: identity.contractTicker,
      providerContractId: identity.providerContractId,
    }) ||
    filledQuantity == null ||
    requestedQuantity == null ||
    !quantitiesEqual(filledQuantity, requestedQuantity) ||
    (orderPosition.quantity != null &&
      (mirroredQuantity == null ||
        !quantitiesEqual(mirroredQuantity, filledQuantity)))
  ) {
    return null;
  }
  return filledQuantity;
}

function eventMatchesLifecycle(
  event: ExecutionEvent,
  deploymentId: string,
  identity: SignalOptionsLifecycleIdentity,
) {
  if (
    event.deploymentId !== deploymentId ||
    isHistoricalSignalOptionsLifecycleEvent(event)
  ) {
    return false;
  }
  const candidateIdentity = lifecycleIdentity(asRecord(event.payload));
  if (
    candidateIdentity &&
    event.eventType === SIGNAL_OPTIONS_ENTRY_EVENT &&
    signalOptionsLifecycleEntryIdentityMatches(candidateIdentity, identity)
  ) {
    return true;
  }
  return Boolean(
    candidateIdentity &&
      signalOptionsLifecycleIdentitiesMatch(candidateIdentity, identity),
  );
}

export function resolveSignalOptionsLifecycleIdentity(
  event: Pick<ExecutionEvent, "eventType" | "payload">,
): SignalOptionsLifecycleIdentity | null {
  return event.eventType === SIGNAL_OPTIONS_EXIT_EVENT
    ? lifecycleIdentity(asRecord(event.payload))
    : null;
}

export function resolveSignalOptionsLifecycleExitFenceKey(
  event: Pick<ExecutionEvent, "deploymentId" | "eventType" | "payload">,
): string | null {
  if (
    event.eventType !== SIGNAL_OPTIONS_EXIT_EVENT ||
    !event.deploymentId ||
    isHistoricalSignalOptionsLifecycleEvent(
      event as Pick<ExecutionEvent, "payload">,
    )
  ) {
    return null;
  }
  const identity = resolveSignalOptionsLifecycleIdentity(event);
  return identity
    ? JSON.stringify([
        "pyrus:signal-options:exit-fence:v3",
        event.deploymentId,
        identity.positionId,
        identity.openedAt,
      ])
    : null;
}

function signalOptionsLifecycleExitFenceKeys(
  event: Pick<ExecutionEvent, "deploymentId" | "eventType" | "payload">,
) {
  const currentKey = resolveSignalOptionsLifecycleExitFenceKey(event);
  return currentKey ? [currentKey] : [];
}

function lifecyclePositionKeySql(payload: SQLWrapper) {
  return sql<string | null>`coalesce(
    nullif(btrim(${payload}->'metadata'->>'positionKey', ${javascriptTrimCharactersSql}), ''),
    nullif(btrim(${payload}->>'positionKey', ${javascriptTrimCharactersSql}), ''),
    nullif(btrim(${payload}->'preExitPosition'->>'positionKey', ${javascriptTrimCharactersSql}), ''),
    nullif(btrim(${payload}->'position'->>'positionKey', ${javascriptTrimCharactersSql}), '')
  )`;
}

function lifecycleContractIdentifiersSql(payload: SQLWrapper) {
  const contract = sql`coalesce(
    nullif(${payload}->'selectedContract', 'null'::jsonb),
    ${payload}->'preExitPosition'->'selectedContract',
    ${payload}->'position'->'selectedContract'
  )`;
  return {
    ticker: sql<string | null>`nullif(
      btrim(${contract}->>'ticker', ${javascriptTrimCharactersSql}),
      ''
    )`,
    providerContractId: sql<string | null>`nullif(
      btrim(${contract}->>'providerContractId', ${javascriptTrimCharactersSql}),
      ''
    )`,
  };
}

const defaultSignalOptionsLifecycleExitFenceDependencies: SignalOptionsLifecycleExitFenceDependencies =
  {
    withLifecycleLock: async (keys, work) =>
      db.transaction(async (tx) => {
        for (const key of [...keys].sort()) {
          const lockResult = (await tx.execute(sql`
            select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as locked
          `)) as unknown as { rows: Array<{ locked: boolean }> };
          if (lockResult.rows[0]?.locked !== true) {
            return { acquired: false };
          }
        }
        const result = await work({
          // ponytail: use the existing deployment/time index and exact-match the
          // lifecycle in JS; add indexed lifecycle columns only if this bounded
          // post-open scan is measured as a production bottleneck.
          listEvents: (input) => {
            const positionKey = lifecyclePositionKeySql(
              executionEventsTable.payload,
            );
            const contractIdentifiers = lifecycleContractIdentifiersSql(
              executionEventsTable.payload,
            );
            const contractOverlap = sql`(
              (
                ${input.contractTicker}::text is not null
                and ${contractIdentifiers.ticker} = ${input.contractTicker}
              )
              or (
                ${input.providerContractId}::text is not null
                and ${contractIdentifiers.providerContractId} =
                  ${input.providerContractId}
              )
            )`;
            return tx
              .select()
              .from(executionEventsTable)
              .where(
                and(
                  eq(executionEventsTable.deploymentId, input.deploymentId),
                  inArray(executionEventsTable.eventType, [
                    SIGNAL_OPTIONS_ENTRY_EVENT,
                    SIGNAL_OPTIONS_EXIT_EVENT,
                  ]),
                  eq(executionEventsTable.symbol, input.symbol),
                  gte(executionEventsTable.occurredAt, input.openedAt),
                  lte(executionEventsTable.occurredAt, input.maxOccurredAt),
                  not(
                    signalOptionsHistoricalLifecycleEventSql(
                      executionEventsTable.payload,
                    ),
                  ),
                  sql`coalesce(
                    nullif(btrim(${executionEventsTable.payload}->'preExitPosition'->>'id', ${javascriptTrimCharactersSql}), ''),
                    nullif(btrim(${executionEventsTable.payload}->'position'->>'id', ${javascriptTrimCharactersSql}), '')
                  ) = ${input.positionId}`,
                  sql`case
                    when pg_input_is_valid(
                      coalesce(
                        nullif(btrim(${executionEventsTable.payload}->'preExitPosition'->>'openedAt', ${javascriptTrimCharactersSql}), ''),
                        nullif(btrim(${executionEventsTable.payload}->'position'->>'openedAt', ${javascriptTrimCharactersSql}), '')
                      ),
                      'timestamptz'
                    )
                    then coalesce(
                      nullif(btrim(${executionEventsTable.payload}->'preExitPosition'->>'openedAt', ${javascriptTrimCharactersSql}), ''),
                      nullif(btrim(${executionEventsTable.payload}->'position'->>'openedAt', ${javascriptTrimCharactersSql}), '')
                    )::timestamptz
                  end = ${input.openedAt}`,
                  sql`(
                    (
                      ${executionEventsTable.eventType} = ${SIGNAL_OPTIONS_ENTRY_EVENT}
                      and ${positionKey} is null
                    )
                    or (
                      ${input.positionKey}::text is null
                      and ${positionKey} is null
                    )
                    or ${positionKey} = ${input.positionKey}
                    or ${contractOverlap}
                  )`,
                  sql`(
                    (
                      ${executionEventsTable.eventType} = ${SIGNAL_OPTIONS_ENTRY_EVENT}
                      and ${contractIdentifiers.ticker} is null
                      and ${contractIdentifiers.providerContractId} is null
                    )
                    or (
                      ${input.contractTicker}::text is null
                      and ${input.providerContractId}::text is null
                      and ${contractIdentifiers.ticker} is null
                      and ${contractIdentifiers.providerContractId} is null
                    )
                    or ${contractOverlap}
                  )`,
                ),
              )
              .orderBy(
                asc(executionEventsTable.occurredAt),
                asc(executionEventsTable.id),
              )
              .limit(input.maxRows + 1);
          },
          currentTime: async () => {
            const result = (await tx.execute(sql`
              select transaction_timestamp() as current_time
            `)) as unknown as { rows: Array<{ current_time: unknown }> };
            return new Date(
              result.rows[0]?.current_time as string | number | Date,
            );
          },
          loadEntryOrder: async (orderId, linkedEntryId) => {
            const [order] = await tx
              .select()
              .from(shadowOrdersTable)
              .where(
                and(
                  eq(shadowOrdersTable.id, orderId),
                  eq(
                    shadowOrdersTable.accountId,
                    SIGNAL_OPTIONS_SHADOW_ACCOUNT_ID,
                  ),
                  eq(shadowOrdersTable.source, "automation"),
                  eq(shadowOrdersTable.assetClass, "option"),
                  eq(shadowOrdersTable.side, "buy"),
                  eq(shadowOrdersTable.status, "filled"),
                  linkedEntryId
                    ? or(
                        sql`${shadowOrdersTable.sourceEventId} is null`,
                        eq(shadowOrdersTable.sourceEventId, linkedEntryId),
                      )
                    : sql`(
                        ${shadowOrdersTable.sourceEventId} is null
                        or not exists (
                          select 1
                          from ${executionEventsTable} linked_entry
                          where linked_entry.id = ${shadowOrdersTable.sourceEventId}
                        )
                      )`,
                  not(
                    signalOptionsHistoricalLifecycleEventSql(
                      shadowOrdersTable.payload,
                    ),
                  ),
                ),
              )
              .limit(1);
            return order ?? null;
          },
          insertEvent: async (event) => {
            const [inserted] = await tx
              .insert(executionEventsTable)
              .values({
                id: event.id,
                deploymentId: event.deploymentId,
                algoRunId: event.algoRunId,
                providerAccountId: event.providerAccountId,
                symbol: event.symbol,
                eventType: event.eventType,
                summary: event.summary,
                payload: event.payload,
                occurredAt: event.occurredAt,
              })
              .onConflictDoNothing({ target: executionEventsTable.id })
              .returning();
            if (inserted) {
              return inserted;
            }
            const [existing] = await tx
              .select()
              .from(executionEventsTable)
              .where(eq(executionEventsTable.id, event.id))
              .limit(1);
            const identity = resolveSignalOptionsLifecycleIdentity(event);
            const eventPayload = asRecord(event.payload);
            const existingPayload = asRecord(existing?.payload);
            const eventPartialAction =
              signalOptionsPartialExitActionKey(eventPayload);
            const existingPartialAction =
              signalOptionsPartialExitActionKey(existingPayload);
            const sameAction =
              eventPayload.partial === true
                ? existingPayload.partial === true &&
                  eventPartialAction != null &&
                  existingPartialAction === eventPartialAction
                : existingPayload.partial !== true;
            if (
              !existing ||
              !event.deploymentId ||
              existing.eventType !== event.eventType ||
              existing.symbol !== event.symbol ||
              !identity ||
              !eventMatchesLifecycle(existing, event.deploymentId, identity) ||
              !sameAction
            ) {
              throw new Error("Signal-options execution-event id conflict.");
            }
            return null;
          },
        });
        return { acquired: true, result };
      }),
  };

export async function persistSignalOptionsLifecycleExitWithFence(
  event: ExecutionEvent,
  signal?: AbortSignal,
  dependencies: SignalOptionsLifecycleExitFenceDependencies = defaultSignalOptionsLifecycleExitFenceDependencies,
): Promise<SignalOptionsLifecycleExitFenceResult> {
  signal?.throwIfAborted();
  const key = resolveSignalOptionsLifecycleExitFenceKey(event);
  const lockKeys = signalOptionsLifecycleExitFenceKeys(event);
  const identity = resolveSignalOptionsLifecycleIdentity(event);
  const symbol = nonEmptyString(event.symbol);
  if (!key || !lockKeys.length || !identity || !event.deploymentId || !symbol) {
    return { status: "invalid" };
  }
  const openedAt = new Date(identity.openedAt);
  const occurredAtMs = event.occurredAt.getTime();
  if (!Number.isFinite(occurredAtMs) || occurredAtMs < openedAt.getTime()) {
    return { status: "invalid" };
  }
  const locked = await dependencies.withLifecycleLock(
    lockKeys,
    async (ledger) => {
      signal?.throwIfAborted();
      const currentTime = ledger.currentTime
        ? await ledger.currentTime()
        : new Date();
      if (
        Number.isNaN(currentTime.getTime()) ||
        occurredAtMs > currentTime.getTime()
      ) {
        return { status: "invalid" };
      }
      const events = await ledger.listEvents({
        deploymentId: event.deploymentId!,
        symbol,
        positionId: identity.positionId,
        openedAt,
        positionKey: identity.positionKey,
        contractTicker: identity.contractTicker,
        providerContractId: identity.providerContractId,
        maxOccurredAt: currentTime,
        maxRows: SIGNAL_OPTIONS_LIFECYCLE_EVENT_SCAN_LIMIT,
      });
      signal?.throwIfAborted();
      if (events.length > SIGNAL_OPTIONS_LIFECYCLE_EVENT_SCAN_LIMIT) {
        return { status: "invalid" };
      }
      const liveEvents = events.filter(
        (candidate) =>
          !isHistoricalSignalOptionsLifecycleEvent(candidate) &&
          Number.isFinite(candidate.occurredAt.getTime()) &&
          candidate.occurredAt.getTime() <= currentTime.getTime(),
      );
      const duplicate = liveEvents.find(
        (candidate) => candidate.id === event.id,
      );
      if (duplicate) {
        return { status: "duplicate", event: duplicate };
      }
      const partialActionKey = signalOptionsPartialExitActionKey(
        asRecord(event.payload),
      );
      const semanticDuplicate = partialActionKey
        ? liveEvents.find(
            (candidate) =>
              candidate.eventType === SIGNAL_OPTIONS_EXIT_EVENT &&
              signalOptionsPartialExitActionKey(asRecord(candidate.payload)) ===
                partialActionKey &&
              eventMatchesLifecycle(candidate, event.deploymentId!, identity),
          )
        : null;
      if (semanticDuplicate) {
        return { status: "duplicate", event: semanticDuplicate };
      }
      const entry = liveEvents.find(
        (candidate) =>
          candidate.eventType === SIGNAL_OPTIONS_ENTRY_EVENT &&
          eventMatchesLifecycle(candidate, event.deploymentId!, identity),
      );
      const eventEntryQuantity = finitePositiveNumber(
        asRecord(asRecord(entry?.payload).position).quantity,
      );
      if (entry && eventEntryQuantity == null) {
        return { status: "invalid" };
      }
      const payload = asRecord(event.payload);
      const sourceOrderId = nonEmptyString(payload.sourceOrderId);
      const entryOrder =
        sourceOrderId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          sourceOrderId,
        ) &&
        ledger.loadEntryOrder
          ? await ledger.loadEntryOrder(sourceOrderId, entry?.id)
          : null;
      signal?.throwIfAborted();
      const orderEntryQuantity = entryOrder
        ? signalOptionsLifecycleEntryOrderQuantity(event, identity, entryOrder)
        : null;
      const reconciliationFallback =
        payload.maintenance === true &&
        (payload.reason === "ledger_reconcile" ||
          payload.exitReason === "ledger_reconcile");
      if (!entry) {
        if (
          !reconciliationFallback ||
          !sourceOrderId ||
          orderEntryQuantity == null
        ) {
          return { status: "invalid" };
        }
      } else if (
        sourceOrderId &&
        (orderEntryQuantity == null ||
          (entryOrder?.sourceEventId != null &&
            entryOrder.sourceEventId !== entry.id) ||
          !quantitiesEqual(eventEntryQuantity!, orderEntryQuantity))
      ) {
        return { status: "invalid" };
      }

      let remainingQuantity = eventEntryQuantity ?? orderEntryQuantity!;
      for (const candidate of liveEvents) {
        if (
          candidate.eventType !== SIGNAL_OPTIONS_EXIT_EVENT ||
          !eventMatchesLifecycle(candidate, event.deploymentId!, identity)
        ) {
          continue;
        }
        const payload = asRecord(candidate.payload);
        if (payload.partial !== true) {
          remainingQuantity = 0;
          break;
        }
        const sold = exitQuantity(payload);
        if (sold == null || sold >= remainingQuantity - QUANTITY_EPSILON) {
          return { status: "invalid" };
        }
        remainingQuantity = Number((remainingQuantity - sold).toFixed(8));
      }
      if (remainingQuantity <= QUANTITY_EPSILON) {
        return { status: "inactive" };
      }

      const snapshotQuantity = preExitQuantity(payload);
      const sold = exitQuantity(payload);
      if (
        snapshotQuantity == null ||
        sold == null ||
        !quantitiesEqual(snapshotQuantity, remainingQuantity)
      ) {
        return { status: "stale" };
      }
      if (payload.partial === true) {
        const nextQuantity = Number((remainingQuantity - sold).toFixed(8));
        if (nextQuantity <= QUANTITY_EPSILON) {
          return { status: "invalid" };
        }
        const declaredRemaining = finitePositiveNumber(
          payload.remainingQuantity ??
            asRecord(payload.remainingPosition).quantity,
        );
        if (
          declaredRemaining == null ||
          !quantitiesEqual(declaredRemaining, nextQuantity)
        ) {
          return { status: "stale" };
        }
      } else if (!quantitiesEqual(sold, remainingQuantity)) {
        return { status: "stale" };
      }

      signal?.throwIfAborted();
      const inserted = await ledger.insertEvent(event);
      signal?.throwIfAborted();
      return inserted
        ? { status: "inserted", event: inserted }
        : { status: "duplicate", event };
    },
  );
  return locked.acquired ? locked.result : { status: "busy" };
}

export function signalOptionsPositionExitClaimKey(input: {
  deploymentId: string;
  position: {
    id: string;
    candidateId?: string | null;
    openedAt?: string | null;
  };
  scaleOutId?: string | null;
  signalKey?: string | null;
}) {
  const openedAt = input.position.openedAt?.trim();
  const lifecycleId = openedAt
    ? `${input.position.id}@${openedAt}`
    : input.position.candidateId?.trim() || input.position.id;
  const signalKey = input.signalKey?.trim();
  return [
    input.deploymentId,
    lifecycleId,
    ...(input.scaleOutId
      ? [
          "scale-out",
          input.scaleOutId,
          ...(signalKey ? ["signal", signalKey] : []),
        ]
      : []),
  ].join(":");
}

export function tryClaimSignalOptionsPositionExit(key: string, nowMs: number) {
  for (const [claimedKey, claimedAt] of claimedExits) {
    if (nowMs - claimedAt > EXIT_CLAIM_TTL_MS) claimedExits.delete(claimedKey);
  }
  if (claimedExits.has(key)) return false;
  claimedExits.set(key, nowMs);
  return true;
}

export function releaseSignalOptionsPositionExitClaim(key: string) {
  claimedExits.delete(key);
}

export function resetSignalOptionsPositionExitClaimsForTests() {
  claimedExits.clear();
}
