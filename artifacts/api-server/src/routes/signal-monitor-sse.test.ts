import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { after, test } from "node:test";

import { pool } from "@workspace/db";
import type { Request, Response } from "express";
import {
  buildSignalMonitorMatrixBootstrapFrames,
  startSignalMonitorMatrixSse,
} from "./signal-monitor";

after(async () => {
  await pool.end();
});

class BackpressuredResponse extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writeCalls = 0;

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  setHeader() {}

  flushHeaders() {}

  write(chunk: string): boolean {
    this.writeCalls += 1;
    return chunk.startsWith("retry:");
  }

  end() {
    this.writableEnded = true;
    this.emit("close");
  }
}

class WritableResponse extends BackpressuredResponse {
  override write(): boolean {
    return true;
  }
}

test("Signal Matrix bootstrap frames identify the final page explicitly", () => {
  const states = Array.from({ length: 5 }, (_value, index) => ({
    symbol: `T${index + 1}`,
  }));
  const frames = buildSignalMonitorMatrixBootstrapFrames(
    {
      stream: "signal-matrix",
      event: "bootstrap",
      states,
    } as never,
    2,
  );

  assert.deepEqual(
    frames.map((frame) => ({
      symbols: frame.states.map((state) => state.symbol),
      page: frame.bootstrapPage,
    })),
    [
      {
        symbols: ["T1", "T2"],
        page: {
          index: 0,
          count: 3,
          offset: 0,
          stateCount: 5,
          complete: false,
        },
      },
      {
        symbols: ["T3", "T4"],
        page: {
          index: 1,
          count: 3,
          offset: 2,
          stateCount: 5,
          complete: false,
        },
      },
      {
        symbols: ["T5"],
        page: {
          index: 2,
          count: 3,
          offset: 4,
          stateCount: 5,
          complete: true,
        },
      },
    ],
  );
});

test("Signal Matrix empty bootstrap is one complete page", () => {
  const [frame] = buildSignalMonitorMatrixBootstrapFrames(
    {
      stream: "signal-matrix",
      event: "bootstrap",
      states: [],
    } as never,
    2,
  );

  assert.deepEqual(frame.bootstrapPage, {
    index: 0,
    count: 1,
    offset: 0,
    stateCount: 0,
    complete: true,
  });
  assert.deepEqual(frame.states, []);
});

test("Signal Matrix SSE skips setup when the request already terminated", async (t) => {
  for (const state of [
    "request-aborted",
    "response-destroyed",
    "response-ended",
  ] as const) {
    await t.test(state, async () => {
      const req = Object.assign(new EventEmitter(), { aborted: false });
      const res = new WritableResponse();
      if (state === "request-aborted") {
        req.aborted = true;
        req.emit("aborted");
      } else if (state === "response-destroyed") {
        res.destroyed = true;
        res.emit("close");
      } else {
        res.writableEnded = true;
        res.emit("close");
      }
      let setupCalls = 0;

      try {
        await startSignalMonitorMatrixSse(
          req as unknown as Request,
          res as unknown as Response,
          async () => {
            setupCalls += 1;
            return () => {};
          },
        );

        assert.equal(setupCalls, 0);
      } finally {
        res.emit("close");
      }
    });
  }
});

test("Signal Matrix SSE skips setup when its initial write fails", async () => {
  const req = new EventEmitter();
  const res = new (class extends WritableResponse {
    override write(): boolean {
      throw new Error("socket write failed");
    }
  })();
  let setupCalls = 0;

  await startSignalMonitorMatrixSse(
    req as unknown as Request,
    res as unknown as Response,
    async () => {
      setupCalls += 1;
      return () => {};
    },
  );

  assert.equal(setupCalls, 0);
});

test("Signal Matrix SSE keeps one backpressure waiter per response", async () => {
  const req = new EventEmitter();
  const res = new BackpressuredResponse();
  const pendingWrites: Promise<void>[] = [];

  await startSignalMonitorMatrixSse(
    req as unknown as Request,
    res as unknown as Response,
    async ({ writeComment }) => {
      for (let index = 0; index < 20; index += 1) {
        pendingWrites.push(writeComment(`delta ${index}`));
      }
      return () => {};
    },
  );
  await Promise.resolve();

  assert.equal(res.listenerCount("drain"), 1);
  assert.equal(res.listenerCount("close"), 2);

  res.end();
  await Promise.all(pendingWrites);
  assert.equal(res.listenerCount("drain"), 0);
});

test("Signal Matrix SSE closes a never-draining client at a finite write backlog", async () => {
  const req = new EventEmitter();
  const res = new BackpressuredResponse();
  const pendingWrites: Promise<void>[] = [];
  let cleanupCount = 0;

  await startSignalMonitorMatrixSse(
    req as unknown as Request,
    res as unknown as Response,
    async ({ writeComment }) => {
      for (let index = 0; index < 1_000; index += 1) {
        pendingWrites.push(writeComment(`delta ${index} ${"x".repeat(1_024)}`));
      }
      return () => {
        cleanupCount += 1;
      };
    },
  );
  await Promise.resolve();

  try {
    assert.equal(res.writableEnded, true);
    await Promise.all(pendingWrites);
    assert.equal(cleanupCount, 1);
    assert.equal(res.listenerCount("drain"), 0);
    assert.ok(res.writeCalls < pendingWrites.length);
  } finally {
    if (!res.writableEnded) {
      res.end();
    }
    await Promise.all(pendingWrites);
  }
});

test("Signal Matrix SSE runs registered cleanup once when setup finishes after close", async () => {
  const req = new EventEmitter();
  const res = new WritableResponse();
  let continueSetup!: () => void;
  let cleanupRegistered!: () => void;
  const setupGate = new Promise<void>((resolve) => {
    continueSetup = resolve;
  });
  const registered = new Promise<void>((resolve) => {
    cleanupRegistered = resolve;
  });
  let cleanupCount = 0;
  const release = () => {
    cleanupCount += 1;
  };

  const started = startSignalMonitorMatrixSse(
    req as unknown as Request,
    res as unknown as Response,
    async ({ registerCleanup }) => {
      registerCleanup(release);
      cleanupRegistered();
      await setupGate;
      return release;
    },
  );

  await registered;
  res.end();
  continueSetup();
  await started;

  assert.equal(cleanupCount, 1);
});

test("Signal Matrix SSE releases setup resources when bootstrap fails", async () => {
  const req = new EventEmitter();
  const res = new WritableResponse();
  let cleanupCount = 0;

  await startSignalMonitorMatrixSse(
    req as unknown as Request,
    res as unknown as Response,
    async (controls) => {
      const registerCleanup = (
        controls as typeof controls & {
          registerCleanup: (cleanup: () => void) => void;
        }
      ).registerCleanup;
      registerCleanup(() => {
        cleanupCount += 1;
      });
      throw new Error("bootstrap failed");
    },
  );

  assert.equal(cleanupCount, 1);
});
