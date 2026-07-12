import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import pg from "pg";

import {
  createPostgresConnectionExhaustionGate,
  createPostgresConnectionExhaustionGatedClient,
} from "./connection-exhaustion-gate";

const exhausted = () =>
  Object.assign(new Error("sorry, too many clients already"), {
    code: "53300",
  });

test("connection exhaustion opens one half-open probe after the cooldown", async () => {
  let nowMs = 1_000;
  let attempts = 0;
  let resolveProbe!: (value: string) => void;
  const gate = createPostgresConnectionExhaustionGate({
    backoffMs: 5_000,
    now: () => nowMs,
  });

  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw exhausted();
    }),
    { code: "53300" },
  );
  assert.equal(attempts, 1);

  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      return "unexpected";
    }),
    { code: "53300" },
  );
  assert.equal(attempts, 1);

  nowMs += 5_000;
  const probe = gate.connect(
    () =>
      new Promise<string>((resolve) => {
        attempts += 1;
        resolveProbe = resolve;
      }),
  );
  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      return "unexpected";
    }),
    { code: "53300" },
  );
  assert.equal(attempts, 2);

  resolveProbe("connected");
  assert.equal(await probe, "connected");
  assert.equal(
    await gate.connect(async () => {
      attempts += 1;
      return "next";
    }),
    "next",
  );
  assert.equal(attempts, 3);
});

test("non-exhaustion failures do not open the gate", async () => {
  let attempts = 0;
  const gate = createPostgresConnectionExhaustionGate();

  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw Object.assign(new Error("authentication failed"), {
        code: "28P01",
      });
    }),
    { code: "28P01" },
  );
  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw Object.assign(new Error("authentication failed"), {
        code: "28P01",
      });
    }),
    { code: "28P01" },
  );
  assert.equal(attempts, 2);
});

test("connection exhaustion follows nested causes", async () => {
  let attempts = 0;
  const gate = createPostgresConnectionExhaustionGate();

  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw new Error("physical connection failed", { cause: exhausted() });
    }),
    /physical connection failed/,
  );
  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      return "unexpected";
    }),
    /physical connection failed/,
  );
  assert.equal(attempts, 1);
});

test("a failed half-open exhaustion probe starts a fresh cooldown", async () => {
  let nowMs = 1_000;
  let attempts = 0;
  const gate = createPostgresConnectionExhaustionGate({
    backoffMs: 5_000,
    now: () => nowMs,
  });
  const fail = () =>
    gate.connect(async () => {
      attempts += 1;
      throw exhausted();
    });

  await assert.rejects(fail(), { code: "53300" });
  nowMs += 5_000;
  await assert.rejects(fail(), { code: "53300" });
  nowMs += 4_999;
  await assert.rejects(fail(), { code: "53300" });
  assert.equal(attempts, 2);
  nowMs += 1;
  await assert.rejects(fail(), { code: "53300" });
  assert.equal(attempts, 3);
});

test("a non-exhaustion half-open failure clears the exhaustion gate", async () => {
  let nowMs = 1_000;
  let attempts = 0;
  const gate = createPostgresConnectionExhaustionGate({
    backoffMs: 5_000,
    now: () => nowMs,
  });

  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw exhausted();
    }),
    { code: "53300" },
  );
  nowMs += 5_000;
  await assert.rejects(
    gate.connect(async () => {
      attempts += 1;
      throw Object.assign(new Error("authentication failed"), {
        code: "28P01",
      });
    }),
    { code: "28P01" },
  );
  assert.equal(
    await gate.connect(async () => {
      attempts += 1;
      return "recovered";
    }),
    "recovered",
  );
  assert.equal(attempts, 3);
});

test("53300 blocks new physical opens without blocking idle pool clients", async () => {
  let physicalAttempts = 0;
  let failPhysical = false;

  class FakeClient extends EventEmitter {
    _queryable = true;
    _ending = false;

    constructor(_config?: unknown) {
      super();
    }

    connect(
      callback?: (error: Error | null, client?: this) => void,
    ): Promise<this> | void {
      physicalAttempts += 1;
      const pending = new Promise<this>((resolve, reject) => {
        process.nextTick(() => {
          if (failPhysical) {
            reject(exhausted());
          } else {
            resolve(this);
          }
        });
      });
      if (!callback) {
        return pending;
      }
      void pending.then(
        (client) => callback(null, client),
        (error: Error) => callback(error),
      );
    }

    end(callback?: () => void): void {
      this._ending = true;
      process.nextTick(() => callback?.());
    }
  }

  const gate = createPostgresConnectionExhaustionGate();
  const GatedClient = createPostgresConnectionExhaustionGatedClient(
    FakeClient,
    gate,
  );
  const idlePool = new pg.Pool({ max: 1, Client: GatedClient as never });
  const emptyPool = new pg.Pool({ max: 1, Client: GatedClient as never });

  try {
    const warm = await idlePool.connect();
    warm.release();
    failPhysical = true;
    await assert.rejects(emptyPool.connect(), { code: "53300" });
    assert.equal(physicalAttempts, 2);

    await new Promise<void>((resolve, reject) => {
      idlePool.connect((error, client, release) => {
        if (error || !client || !release) {
          reject(error ?? new Error("idle checkout did not return a client"));
          return;
        }
        release();
        resolve();
      });
    });
    assert.equal(
      physicalAttempts,
      2,
      "idle checkout must not attempt a new physical connection",
    );

    await assert.rejects(emptyPool.connect(), { code: "53300" });
    assert.equal(
      physicalAttempts,
      2,
      "open gate must fast-fail a new physical connection attempt",
    );
  } finally {
    await Promise.all([idlePool.end(), emptyPool.end()]);
  }
});

test("every process-owned Postgres socket shares the physical connection gate", () => {
  const indexSource = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
  const advisorySource = readFileSync(
    new URL("./advisory-lock.ts", import.meta.url),
    "utf8",
  );

  assert.equal(
    indexSource.match(/Client: ConnectionExhaustionGatedClient/g)?.length,
    3,
    "main, trading, and auth pools must all gate physical socket opens",
  );
  assert.match(indexSource, /postgresConnectionExhaustionGate/);
  assert.match(advisorySource, /postgresConnectionExhaustionGate/);
  assert.match(
    advisorySource,
    /new ConnectionExhaustionGatedClient\(/,
    "the dedicated advisory-lock connection must use the same gate",
  );
});
