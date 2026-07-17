import assert from "node:assert/strict";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { DbAdmissionTimeoutError } from "@workspace/db";
import express from "express";

import { apiErrorHandler } from "./app";

async function requestAdmissionTimeout(
  error: DbAdmissionTimeoutError,
): Promise<Response> {
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
    const response = await requestAdmissionTimeout(
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
