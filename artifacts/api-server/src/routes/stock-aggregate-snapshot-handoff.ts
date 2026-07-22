import type { StockMinuteAggregateMessage } from "../services/stock-aggregate-stream";

type EmitAggregate = (
  message: StockMinuteAggregateMessage,
  serializeEvent?: () => string,
) => void | Promise<void>;

export function createStockAggregateSnapshotUpdateQueue() {
  let tail: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(update: () => Promise<T>): Promise<T> {
    const result = tail.then(update, update);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}

export function createStockAggregateSnapshotHandoff(emit: EmitAggregate) {
  let buffering = true;
  const bufferedBySymbolMinute = new Map<
    string,
    {
      message: StockMinuteAggregateMessage;
      serializeEvent?: () => string;
    }
  >();
  const key = (message: StockMinuteAggregateMessage) =>
    `${message.symbol}:${message.startMs}`;

  return {
    beginSnapshot() {
      buffering = true;
    },
    captureSnapshot(aggregates: StockMinuteAggregateMessage[]) {
      // Broadcasts are recorded in the aggregate history before fan-out. Any
      // buffered identity already present at materialization is therefore in
      // this snapshot; only events arriving during its async writes remain.
      aggregates.forEach((message) => {
        bufferedBySymbolMinute.delete(key(message));
      });
    },
    accept(message: StockMinuteAggregateMessage, serializeEvent?: () => string) {
      if (buffering) {
        bufferedBySymbolMinute.set(key(message), { message, serializeEvent });
        return;
      }
      emit(message, serializeEvent);
    },
    async finishSnapshot() {
      // Keep buffering until every event captured during the asynchronous
      // snapshot and drain has been emitted. Newer corrections that arrive
      // while an older batch awaits socket backpressure form the next batch,
      // preserving the snapshot -> live ordering without a numeric drop cap.
      while (bufferedBySymbolMinute.size > 0) {
        const buffered = Array.from(bufferedBySymbolMinute.values());
        bufferedBySymbolMinute.clear();
        for (const { message, serializeEvent } of buffered) {
          await emit(message, serializeEvent);
        }
      }
      buffering = false;
    },
  };
}
