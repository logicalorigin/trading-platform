import { logger } from "../lib/logger";
import {
  getShadowAccountAllocation,
  getShadowAccountClosedTrades,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountRisk,
  getShadowAccountSummary,
} from "./shadow-account";
import { subscribeShadowAccountChanges } from "./shadow-account-events";

type Unsubscribe = () => void;
const SHADOW_ACCOUNT_SNAPSHOT_TTL_MS = 2_000;
export const SHADOW_ACCOUNT_STREAM_INTERVAL_MS = 2_000;

type ShadowAccountSnapshotBase = {
  summary: Awaited<ReturnType<typeof getShadowAccountSummary>>;
  positions: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  workingOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  historyOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  allocation: Awaited<ReturnType<typeof getShadowAccountAllocation>>;
  risk: Awaited<ReturnType<typeof getShadowAccountRisk>>;
  updatedAt: string;
};

let shadowAccountSnapshotBaseCache:
  | {
      value: ShadowAccountSnapshotBase;
      expiresAt: number;
    }
  | null = null;
let shadowAccountSnapshotBaseInFlight: Promise<ShadowAccountSnapshotBase> | null =
  null;

export function invalidateShadowAccountSnapshotBaseCache() {
  shadowAccountSnapshotBaseCache = null;
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
  subscribeImmediate?: (listener: () => void) => Unsubscribe;
  beforeImmediateSnapshot?: () => void;
}): Unsubscribe {
  let active = true;
  let inFlight = false;
  let queued = false;
  let lastSignature = "";

  const tick = async () => {
    if (!active || inFlight) {
      if (inFlight) {
        queued = true;
      }
      return;
    }

    inFlight = true;
    try {
      do {
        queued = false;
        const snapshot = await fetchSnapshot();
        if (!active) {
          return;
        }

        const signature = stableStringify(snapshot);
        const changed = signature !== lastSignature;
        if (changed) {
          lastSignature = signature;
          onSnapshot(snapshot);
        }
        await onPollSuccess?.({ snapshot, changed });
      } while (active && queued);
    } catch (error) {
      logger.warn({ err: error }, "Shadow account stream polling failed");
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref?.();
  const unsubscribeImmediate =
    subscribeImmediate?.(() => {
      beforeImmediateSnapshot?.();
      void tick();
    }) ?? (() => undefined);
  void tick();

  return () => {
    active = false;
    clearInterval(timer);
    unsubscribeImmediate();
  };
}

export async function fetchShadowAccountSnapshotPayload(): Promise<{
  summary: Awaited<ReturnType<typeof getShadowAccountSummary>>;
  positions: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  workingOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  historyOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  allocation: Awaited<ReturnType<typeof getShadowAccountAllocation>>;
  risk: Awaited<ReturnType<typeof getShadowAccountRisk>>;
  updatedAt: string;
}> {
  return fetchShadowAccountSnapshotBase();
}

export async function fetchShadowAccountSnapshotBase(): Promise<ShadowAccountSnapshotBase> {
  const now = Date.now();
  if (
    shadowAccountSnapshotBaseCache &&
    shadowAccountSnapshotBaseCache.expiresAt > now
  ) {
    return shadowAccountSnapshotBaseCache.value;
  }
  if (shadowAccountSnapshotBaseInFlight) {
    return shadowAccountSnapshotBaseInFlight;
  }

  shadowAccountSnapshotBaseInFlight = (async () => {
    const [summary, positions, workingOrders, historyOrders, allocation, closedTrades] =
      await Promise.all([
        getShadowAccountSummary(),
        getShadowAccountPositions({}),
        getShadowAccountOrders({ tab: "working" }),
        getShadowAccountOrders({ tab: "history" }),
        getShadowAccountAllocation(),
        getShadowAccountClosedTrades({}),
      ]);
    const risk = await getShadowAccountRisk({
      positionsResponse: positions,
      closedTrades,
    });
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
    shadowAccountSnapshotBaseCache = {
      value,
      expiresAt: Date.now() + SHADOW_ACCOUNT_SNAPSHOT_TTL_MS,
    };
    return value;
  })();

  try {
    return await shadowAccountSnapshotBaseInFlight;
  } finally {
    shadowAccountSnapshotBaseInFlight = null;
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
