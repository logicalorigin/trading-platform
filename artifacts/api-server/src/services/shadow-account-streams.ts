import { logger } from "../lib/logger";
import {
  getShadowAccountAllocationFromPositions,
  getShadowAccountClosedTrades,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountRisk,
  getShadowAccountSummaryFromPositions,
} from "./shadow-account";
import {
  subscribeShadowAccountChanges,
  type ShadowAccountChange,
} from "./shadow-account-events";
import { currentShadowAccountId } from "./shadow-account-context";

type Unsubscribe = () => void;
const SHADOW_ACCOUNT_SNAPSHOT_TTL_MS = 15_000;
export const SHADOW_ACCOUNT_STREAM_INTERVAL_MS = 2_000;

type ShadowAccountSnapshotBase = {
  summary: Awaited<ReturnType<typeof getShadowAccountSummaryFromPositions>>;
  positions: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  workingOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  historyOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  allocation: Awaited<ReturnType<typeof getShadowAccountAllocationFromPositions>>;
  risk: Awaited<ReturnType<typeof getShadowAccountRisk>>;
  updatedAt: string;
};

// Slice 5.5: per-account (keyed by the resolved shadow account id) so one user's
// stream snapshot is never served to another. Platform callers share "shadow".
const shadowAccountSnapshotBaseCache = new Map<
  string,
  {
    value: ShadowAccountSnapshotBase;
    expiresAt: number;
  }
>();
const shadowAccountSnapshotBaseInFlight = new Map<
  string,
  Promise<ShadowAccountSnapshotBase>
>();
let shadowAccountSnapshotBaseVersion = 0;

export function invalidateShadowAccountSnapshotBaseCache() {
  shadowAccountSnapshotBaseCache.clear();
  shadowAccountSnapshotBaseInFlight.clear();
  shadowAccountSnapshotBaseVersion += 1;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value);
}

function latestIsoTimestamp(...values: unknown[]): string {
  const timestamps = values
    .map((value) => {
      if (value instanceof Date) {
        return value.getTime();
      }
      if (typeof value === "string" || typeof value === "number") {
        const timestamp = new Date(value).getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
      }
      return 0;
    })
    .filter((value) => value > 0);

  return new Date(timestamps.length ? Math.max(...timestamps) : 0).toISOString();
}

function stableShadowOrdersResponse<
  T extends Awaited<ReturnType<typeof getShadowAccountOrders>>,
>(ordersResponse: T, fallbackUpdatedAt: unknown): T {
  const updatedAt = latestIsoTimestamp(
    fallbackUpdatedAt,
    ...ordersResponse.orders.flatMap((order) => [
      order.updatedAt,
      order.filledAt,
      order.placedAt,
    ]),
  );

  return {
    ...ordersResponse,
    updatedAt: new Date(updatedAt),
  };
}

function createPollingStream<T>({
  intervalMs,
  fetchSnapshot,
  onSnapshot,
  onPollSuccess,
  subscribeImmediate,
  beforeImmediateSnapshot,
}: {
  intervalMs: number;
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
  onPollSuccess?: (input: { snapshot: T; changed: boolean }) => void | Promise<void>;
  subscribeImmediate?: (listener: (change: ShadowAccountChange) => void) => Unsubscribe;
  beforeImmediateSnapshot?: () => void;
}): Unsubscribe {
  let active = true;
  let inFlight = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastSignature = "";
  let lastSnapshot: T | null = null;

  function scheduleNext() {
    if (!active) {
      return;
    }
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, intervalMs);
    timer.unref?.();
  }

  const tick = async () => {
    if (!active || inFlight) {
      return;
    }

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    inFlight = true;
    try {
      const snapshot = await fetchSnapshot();
      if (!active) {
        return;
      }

      let changed = false;
      if (snapshot !== lastSnapshot) {
        const signature = stableStringify(snapshot);
        changed = signature !== lastSignature;
        lastSignature = signature;
        lastSnapshot = snapshot;
      }
      if (changed) {
        onSnapshot(snapshot);
      }
      await onPollSuccess?.({ snapshot, changed });
    } catch (error) {
      logger.warn({ err: error }, "Shadow account stream polling failed");
    } finally {
      inFlight = false;
      scheduleNext();
    }
  };

  const unsubscribeImmediate =
    subscribeImmediate?.((change) => {
      if (change.reason === "mark_refresh") {
        return;
      }
      beforeImmediateSnapshot?.();
      void tick();
    }) ?? (() => undefined);
  void tick();

  return () => {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    unsubscribeImmediate();
  };
}

export const __shadowAccountStreamInternalsForTests = {
  createPollingStream,
};

export async function fetchShadowAccountSnapshotPayload(): Promise<{
  summary: Awaited<ReturnType<typeof getShadowAccountSummaryFromPositions>>;
  positions: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  workingOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  historyOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  allocation: Awaited<ReturnType<typeof getShadowAccountAllocationFromPositions>>;
  risk: Awaited<ReturnType<typeof getShadowAccountRisk>>;
  updatedAt: string;
}> {
  return fetchShadowAccountSnapshotBase();
}

export async function fetchShadowAccountSnapshotBase(): Promise<ShadowAccountSnapshotBase> {
  const accountId = currentShadowAccountId();
  const now = Date.now();
  const cached = shadowAccountSnapshotBaseCache.get(accountId);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const pending = shadowAccountSnapshotBaseInFlight.get(accountId);
  if (pending) {
    return pending;
  }

  const version = shadowAccountSnapshotBaseVersion;
  const request = (async () => {
    const [positions, workingOrders, historyOrders, closedTrades] =
      await Promise.all([
        getShadowAccountPositions({ liveQuotes: true }),
        getShadowAccountOrders({ tab: "working" }),
        getShadowAccountOrders({ tab: "history" }),
        getShadowAccountClosedTrades({}),
      ]);
    const [summary, allocation, risk] = await Promise.all([
      getShadowAccountSummaryFromPositions({ positionsResponse: positions }),
      Promise.resolve(
        getShadowAccountAllocationFromPositions({ positionsResponse: positions }),
      ),
      getShadowAccountRisk({
        positionsResponse: positions,
        closedTrades,
        detail: "fast",
      }),
    ]);
    const updatedAt = latestIsoTimestamp(
      summary.updatedAt,
      positions.updatedAt,
      allocation.updatedAt,
      risk.updatedAt,
    );
    const value = {
      summary,
      positions,
      workingOrders: stableShadowOrdersResponse(workingOrders, updatedAt),
      historyOrders: stableShadowOrdersResponse(historyOrders, updatedAt),
      allocation,
      risk,
      updatedAt,
    } satisfies ShadowAccountSnapshotBase;
    if (version === shadowAccountSnapshotBaseVersion) {
      shadowAccountSnapshotBaseCache.set(accountId, {
        value,
        expiresAt: Date.now() + SHADOW_ACCOUNT_SNAPSHOT_TTL_MS,
      });
    }
    return value;
  })();
  shadowAccountSnapshotBaseInFlight.set(accountId, request);

  try {
    return await request;
  } finally {
    if (shadowAccountSnapshotBaseInFlight.get(accountId) === request) {
      shadowAccountSnapshotBaseInFlight.delete(accountId);
    }
  }
}

export function subscribeShadowAccountSnapshots(
  onSnapshot: (
    payload: Awaited<ReturnType<typeof fetchShadowAccountSnapshotPayload>>,
  ) => void,
  options: {
    onPollSuccess?: (input: {
      payload: Awaited<ReturnType<typeof fetchShadowAccountSnapshotPayload>>;
      changed: boolean;
    }) => void | Promise<void>;
  } = {},
): Unsubscribe {
  return createPollingStream({
    intervalMs: SHADOW_ACCOUNT_STREAM_INTERVAL_MS,
    fetchSnapshot: fetchShadowAccountSnapshotPayload,
    onSnapshot,
    subscribeImmediate: subscribeShadowAccountChanges,
    beforeImmediateSnapshot: invalidateShadowAccountSnapshotBaseCache,
    onPollSuccess: ({ snapshot, changed }) =>
      options.onPollSuccess?.({ payload: snapshot, changed }),
  });
}
