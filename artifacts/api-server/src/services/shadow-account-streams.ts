import { logger } from "../lib/logger";
import {
  getShadowAccountAllocation,
  getShadowAccountEquityHistory,
  getShadowAccountOrders,
  getShadowAccountPositions,
  getShadowAccountRisk,
  getShadowAccountSummary,
} from "./shadow-account";

type Unsubscribe = () => void;

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
}: {
  intervalMs: number;
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T) => void;
}): Unsubscribe {
  let active = true;
  let inFlight = false;
  let lastSignature = "";

  const tick = async () => {
    if (!active || inFlight) {
      return;
    }

    inFlight = true;
    try {
      const snapshot = await fetchSnapshot();
      if (!active) {
        return;
      }

      const signature = stableStringify(snapshot);
      if (signature !== lastSignature) {
        lastSignature = signature;
        onSnapshot(snapshot);
      }
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
  void tick();

  return () => {
    active = false;
    clearInterval(timer);
  };
}

export async function fetchShadowAccountSnapshotPayload(): Promise<{
  summary: Awaited<ReturnType<typeof getShadowAccountSummary>>;
  positions: Awaited<ReturnType<typeof getShadowAccountPositions>>;
  workingOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  historyOrders: Awaited<ReturnType<typeof getShadowAccountOrders>>;
  allocation: Awaited<ReturnType<typeof getShadowAccountAllocation>>;
  risk: Awaited<ReturnType<typeof getShadowAccountRisk>>;
  equityHistory: Awaited<ReturnType<typeof getShadowAccountEquityHistory>>;
  updatedAt: string;
}> {
  const [
    summary,
    positions,
    workingOrders,
    historyOrders,
    allocation,
    risk,
    equityHistory,
  ] = await Promise.all([
    getShadowAccountSummary(),
    getShadowAccountPositions({}),
    getShadowAccountOrders({ tab: "working" }),
    getShadowAccountOrders({ tab: "history" }),
    getShadowAccountAllocation(),
    getShadowAccountRisk(),
    getShadowAccountEquityHistory({ range: "ALL" }),
  ]);
  const updatedAt = latestIsoTimestamp(
    summary.updatedAt,
    positions.updatedAt,
    allocation.updatedAt,
  );

  return {
    summary,
    positions,
    workingOrders: stableShadowOrdersResponse(workingOrders, updatedAt),
    historyOrders: stableShadowOrdersResponse(historyOrders, updatedAt),
    allocation,
    risk,
    equityHistory,
    updatedAt,
  };
}

export function subscribeShadowAccountSnapshots(
  onSnapshot: (
    payload: Awaited<ReturnType<typeof fetchShadowAccountSnapshotPayload>>,
  ) => void,
): Unsubscribe {
  return createPollingStream({
    intervalMs: 2_000,
    fetchSnapshot: fetchShadowAccountSnapshotPayload,
    onSnapshot,
  });
}
