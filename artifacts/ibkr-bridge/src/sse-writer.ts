import { once } from "node:events";
import type { Response } from "express";
import { logger } from "./logger";

const DEFAULT_MAX_BUFFERED_CHUNKS = 256;
const DEFAULT_DRAIN_TIMEOUT_MS = 5_000;

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export type SseWriter = {
  writeRetry(delayMs: number): Promise<void>;
  writeEvent(event: string, payload: unknown): Promise<void>;
  writeComment(comment: string): Promise<void>;
  close(): void;
  isClosed(): boolean;
};

export function createSseWriter(
  res: Response,
  context: Record<string, unknown> = {},
): SseWriter {
  const maxBufferedChunks = readPositiveIntegerEnv(
    "IBKR_SSE_MAX_BUFFERED_CHUNKS",
    DEFAULT_MAX_BUFFERED_CHUNKS,
  );
  const drainTimeoutMs = readPositiveIntegerEnv(
    "IBKR_SSE_DRAIN_TIMEOUT_MS",
    DEFAULT_DRAIN_TIMEOUT_MS,
  );
  let closed = false;
  let nextEventId = 1;
  let pendingChunks = 0;
  let writeQueue = Promise.resolve();

  const close = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  };

  const waitForDrain = async () => {
    let timeout: NodeJS.Timeout | null = null;
    try {
      await Promise.race([
        once(res, "drain"),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error("SSE client did not drain in time.")),
            drainTimeoutMs,
          );
          timeout.unref?.();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  };

  const enqueue = (chunk: string): Promise<void> => {
    if (closed || res.destroyed || res.writableEnded) {
      return Promise.resolve();
    }

    pendingChunks += 1;
    if (pendingChunks > maxBufferedChunks) {
      logger.warn(
        { ...context, pendingChunks, maxBufferedChunks },
        "Closing slow SSE client after buffered chunk cap",
      );
      close();
      return Promise.resolve();
    }

    writeQueue = writeQueue
      .then(async () => {
        if (closed || res.destroyed || res.writableEnded) {
          return;
        }
        if (!res.write(chunk)) {
          await waitForDrain();
        }
      })
      .catch((error) => {
        logger.warn({ ...context, err: error }, "SSE write failed");
        close();
      })
      .finally(() => {
        pendingChunks = Math.max(0, pendingChunks - 1);
      });

    return writeQueue;
  };

  return {
    writeRetry(delayMs: number): Promise<void> {
      return enqueue(`retry: ${Math.max(0, Math.round(delayMs))}\n\n`);
    },
    writeEvent(event: string, payload: unknown): Promise<void> {
      const eventId = nextEventId;
      nextEventId += 1;
      return enqueue(
        `id: ${eventId}\n` +
          `event: ${event}\n` +
          `data: ${JSON.stringify(payload)}\n\n`,
      );
    },
    writeComment(comment: string): Promise<void> {
      return enqueue(`: ${comment.replace(/\r?\n/g, " ")}\n\n`);
    },
    close,
    isClosed: () => closed,
  };
}
