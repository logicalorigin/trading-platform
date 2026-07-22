import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import {
  currentDbAdmissionSignal,
  DbAdmissionTimeoutError,
} from "@workspace/db";
import express from "express";

import { __httpBoundaryInternalsForTests, apiErrorHandler } from "./app";
import { HttpError } from "./lib/errors";
import { logger } from "./lib/logger";

async function requestError(error: unknown): Promise<Response> {
  const testApp = express();
  testApp.get("/timeout", (_req, _res, next) => next(error));
  testApp.use(apiErrorHandler);

  const server = testApp.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fetch(`http://127.0.0.1:${address.port}/timeout`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

for (const scenario of [
  {
    kind: "acquire" as const,
    lane: "interactive" as const,
    timeoutMs: 2_500,
    retryAfter: "3",
  },
  {
    kind: "shed" as const,
    lane: "background" as const,
    timeoutMs: 400,
    retryAfter: "1",
  },
]) {
  test(`maps ${scenario.kind} admission timeouts to retryable 503 problems`, async () => {
    const response = await requestError(
      new DbAdmissionTimeoutError(
        scenario.lane,
        scenario.timeoutMs,
        scenario.kind,
      ),
    );
    const problem = await response.json();

    assert.equal(response.status, 503);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/problem\+json\b/,
    );
    assert.equal(response.headers.get("retry-after"), scenario.retryAfter);
    assert.deepEqual(problem, {
      type: "https://pyrus.local/problems/database-admission-timeout",
      title: "Database temporarily unavailable",
      status: 503,
      detail:
        "Database capacity is temporarily unavailable. Retry the request.",
      code: "DB_ADMISSION_TIMEOUT",
      kind: scenario.kind,
      lane: scenario.lane,
    });
  });
}

test("redacts non-exposable HttpError response content", async () => {
  const response = await requestError(
    new HttpError(502, "Sensitive upstream response", {
      code: "upstream_http_error",
      detail: "Internal provider detail",
      data: { provider: "private" },
    }),
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    type: "https://pyrus.local/problems/upstream",
    title: "Request failed",
    status: 502,
    code: "upstream_http_error",
  });
});

test("redacts non-exposable HttpError log context", async () => {
  const originalError = logger.error;
  const entries: unknown[] = [];
  logger.error = ((context: unknown) => {
    entries.push(context);
  }) as typeof logger.error;

  try {
    await requestError(
      new HttpError(502, "Sensitive upstream response", {
        code: "upstream_http_error",
        detail: "Internal provider detail",
        data: { provider: "private" },
      }),
    );
  } finally {
    logger.error = originalError;
  }

  assert.deepEqual(entries, [
    { statusCode: 502, code: "upstream_http_error" },
  ]);
});

for (const scenario of [
  { label: "default 4xx", statusCode: 400, expose: undefined },
  { label: "explicit 5xx", statusCode: 502, expose: true },
]) {
  test(`preserves ${scenario.label} HttpError response content`, async () => {
    const response = await requestError(
      new HttpError(scenario.statusCode, "Public response", {
        code: "public_error",
        detail: "Public detail",
        data: { public: true },
        expose: scenario.expose,
      }),
    );

    assert.deepEqual(await response.json(), {
      type: "https://pyrus.local/problems/upstream",
      title: "Public response",
      status: scenario.statusCode,
      detail: "Public detail",
      code: "public_error",
      data: { public: true },
    });
  });
}

test("request disconnect aborts the ambient DB admission signal", () => {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: false });
  let signal: AbortSignal | undefined;

  __httpBoundaryInternalsForTests.runWithRequestDbAdmissionSignal(
    req as never,
    res as never,
    () => {
      signal = currentDbAdmissionSignal();
    },
  );

  assert.ok(signal);
  assert.equal(signal.aborted, false);
  req.emit("aborted");
  assert.equal(signal.aborted, true);
});

test("normal response completion removes disconnect cancellation", () => {
  const req = Object.assign(new EventEmitter(), { aborted: false });
  const res = Object.assign(new EventEmitter(), { writableEnded: false });
  let signal: AbortSignal | undefined;

  __httpBoundaryInternalsForTests.runWithRequestDbAdmissionSignal(
    req as never,
    res as never,
    () => {
      signal = currentDbAdmissionSignal();
    },
  );

  assert.ok(signal);
  res.writableEnded = true;
  res.emit("finish");
  res.emit("close");
  assert.equal(signal.aborted, false);
});

test("client-disconnected database cancellation is not logged as an unhandled 500", () => {
  const abort = new Error("This operation was aborted");
  abort.name = "AbortError";
  const wrapped = new Error("Failed query", { cause: abort });
  const req = { aborted: true };
  let responseWrites = 0;
  const res = {
    headersSent: false,
    destroyed: true,
    status() {
      responseWrites += 1;
      return res;
    },
    type() {
      responseWrites += 1;
      return res;
    },
    json() {
      responseWrites += 1;
      return res;
    },
  };
  const originalError = logger.error;
  const entries: unknown[] = [];
  logger.error = ((context: unknown) => {
    entries.push(context);
  }) as typeof logger.error;

  try {
    apiErrorHandler(wrapped, req as never, res as never, () => {});
  } finally {
    logger.error = originalError;
  }

  assert.equal(responseWrites, 0);
  assert.deepEqual(entries, []);
});

test("client-disconnected late failures are not logged or written", () => {
  const req = { aborted: true };
  let responseWrites = 0;
  const res = {
    headersSent: false,
    destroyed: true,
    status() {
      responseWrites += 1;
      return res;
    },
    type() {
      responseWrites += 1;
      return res;
    },
    json() {
      responseWrites += 1;
      return res;
    },
  };
  const originalError = logger.error;
  const entries: unknown[] = [];
  logger.error = ((context: unknown) => {
    entries.push(context);
  }) as typeof logger.error;

  try {
    apiErrorHandler(
      new HttpError(503, "IBKR Client Portal is not configured.", {
        code: "ibkr_client_portal_not_configured",
        expose: true,
      }),
      req as never,
      res as never,
      () => {},
    );
  } finally {
    logger.error = originalError;
  }

  assert.equal(responseWrites, 0);
  assert.deepEqual(entries, []);
});
