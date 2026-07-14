import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

import {
  __pyrusPortfolioOptimizationInternalsForTests as optimization,
  hasPortfolioOptimizationCapability,
  statusExitCode,
  summarizePortfolioOptimizationJob,
} from "./pyrus-portfolio-optimization";

type FetchJson = (
  baseUrl: string,
  requestPath: string,
  timeoutMs: number,
  init?: RequestInit,
) => Promise<{
  ok: boolean;
  value?: Record<string, unknown>;
  error?: string;
  latencyMs: number;
}>;

const internals = optimization as typeof optimization & {
  errorMessage(error: unknown): string;
  jsonText(value: unknown, space?: number): string;
  readResponseText(response: Response, maximumBytes?: number): Promise<string>;
  fetchJson: FetchJson;
};

function healthySummary(): Record<string, unknown> {
  return {
    pythonCompute: {
      enabled: true,
      status: "healthy",
      healthOk: true,
      healthService: "pyrus-compute",
    },
    capabilities: {
      service: "pyrus-compute",
      hasPortfolioOptimization: true,
    },
    request: {
      objective: "min_variance",
      constraints: { longOnly: true },
      sampleSymbols: ["SPY", "QQQ", "TLT"],
    },
    portfolioOptimization: {
      status: "completed",
      jobId: "job-1",
      jobType: "portfolio_optimization",
      advisoryOnly: true,
      error: null,
      objective: "min_variance",
      turnover: 0.4,
      portfolioVariance: 0.0001,
      portfolioVolatility: 0.01,
      concentration: {
        maxWeight: 0.5,
        topSymbol: "TLT",
        effectivePositionCount: 2.631579,
      },
      constraints: {
        longOnly: true,
        maxWeight: null,
        maxTurnover: null,
      },
      allocationCount: 3,
      allocations: [
        {
          symbol: "SPY",
          currentWeight: 0.5,
          proposedWeight: 0.3,
          deltaWeight: -0.2,
          riskContribution: 0.4,
          expectedReturn: 0.00045,
        },
        {
          symbol: "QQQ",
          currentWeight: 0.3,
          proposedWeight: 0.2,
          deltaWeight: -0.1,
          riskContribution: 0.3,
          expectedReturn: 0.0006,
        },
        {
          symbol: "TLT",
          currentWeight: 0.2,
          proposedWeight: 0.5,
          deltaWeight: 0.3,
          riskContribution: 0.3,
          expectedReturn: 0.0002,
        },
      ],
    },
  };
}

test("CLI parsing is strict, bounded, and treats blank environment values as absent", () => {
  assert.deepEqual(
    internals.parseArgs(
      [
        "--api-base-url=https://example.test/api",
        "--compute-base-url=http://[::1]:18768",
        "--objective=risk_parity",
        "--max-weight=0.8",
        "--max-turnover=0",
        "--timeout-ms=100",
        "--json",
      ],
      {},
    ),
    {
      apiBaseUrl: "https://example.test/api",
      computeBaseUrl: "http://[::1]:18768",
      objective: "risk_parity",
      maxWeight: 0.8,
      maxTurnover: 0,
      timeoutMs: 100,
      json: true,
      help: false,
    },
  );

  const defaults = internals.parseArgs([], {
    API_BASE_URL: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_API_BASE_URL: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_COMPUTE_BASE_URL: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_MAX_TURNOVER: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_MAX_WEIGHT: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_OBJECTIVE: "",
    PYRUS_PORTFOLIO_OPTIMIZATION_TIMEOUT_MS: "",
  });
  assert.equal(defaults.apiBaseUrl, "http://127.0.0.1:18747/api");
  assert.equal(defaults.computeBaseUrl, null);
  assert.equal(defaults.timeoutMs, 30_000);

  for (const args of [
    ["--unknown=value"],
    ["--json=value"],
    ["--json", "--json"],
    ["--api-base-url", "--json"],
    ["--timeout-ms=0"],
    ["--timeout-ms=99"],
    ["--timeout-ms=2.5"],
    ["--timeout-ms=1e3"],
    ["--timeout-ms=300001"],
    ["--api-base-url="],
    ["--api-base-url=file:///tmp/api"],
    ["--api-base-url=https://user:secret@example.test/api"],
    ["--api-base-url=https://example.test/api?token=secret"],
    ["--api-base-url=https://example.test/api#fragment"],
    ["--compute-base-url=https://example.test/compute?token=secret"],
    ["positional"],
  ]) {
    assert.throws(() => internals.parseArgs(args, {}), /Usage:/u);
  }
});

test("help is parsed only after unknown and duplicate options are rejected", () => {
  assert.equal(internals.parseArgs(["--help"], {}).help, true);
  assert.equal(internals.parseArgs(["-h"], {}).help, true);
  assert.throws(
    () => internals.parseArgs(["--help", "--unknown"], {}),
    /Usage:/u,
  );
  assert.throws(
    () => internals.parseArgs(["--help", "--help"], {}),
    /Duplicate options/u,
  );
});

test("capability discovery requires the schema version the inspector submits", () => {
  assert.equal(
    hasPortfolioOptimizationCapability({
      service: "pyrus-compute",
      capabilities: [{ jobType: "portfolio_optimization", schemaVersion: 2 }],
    }),
    false,
  );
  assert.equal(
    hasPortfolioOptimizationCapability({
      service: "pyrus-compute",
      capabilities: [{ jobType: "portfolio_optimization", schemaVersion: 1 }],
    }),
    true,
  );
  assert.equal(
    hasPortfolioOptimizationCapability({
      service: "another-service",
      capabilities: [{ jobType: "portfolio_optimization", schemaVersion: 1 }],
    }),
    false,
  );
});

test("discovered compute URLs validate ports and support IPv6 hosts", () => {
  assert.equal(
    internals.computeBaseUrlFromDiagnostics({ host: "::1", port: 18_768 }),
    "http://[::1]:18768",
  );
  assert.equal(
    internals.computeBaseUrlFromDiagnostics({ host: "compute.test", port: 80 }),
    "http://compute.test",
  );
  assert.equal(
    internals.computeBaseUrlFromDiagnostics({ host: "127.0.0.1", port: 0 }),
    null,
  );
  assert.equal(
    internals.computeBaseUrlFromDiagnostics({
      host: "127.0.0.1",
      port: 65_536,
    }),
    null,
  );
  assert.equal(
    internals.computeBaseUrlFromDiagnostics({
      host: "compute.test?port=80",
      port: 18_768,
    }),
    null,
  );
});

test("successful JSON responses require an object root and normalize parse failures", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("[]", { status: 200 });
    const array = await internals.fetchJson(
      "https://example.test",
      "/array",
      100,
    );
    assert.equal(array.ok, false);
    assert.match(array.error ?? "", /JSON object/u);

    globalThis.fetch = async () => new Response("{", { status: 200 });
    const malformed = await internals.fetchJson(
      "https://example.test",
      "/malformed",
      100,
    );
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error, "Invalid JSON response.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSON response latency includes delayed body reads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          void delay(25).then(() => {
            controller.enqueue(new TextEncoder().encode("{}"));
            controller.close();
          });
        },
      }),
      { status: 200 },
    );
  try {
    const result = await internals.fetchJson(
      "https://example.test",
      "/delayed-body",
      100,
    );
    assert.equal(result.ok, true);
    assert.ok(result.latencyMs >= 20, `latency was ${result.latencyMs}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed HTTP responses cancel bodies the inspector does not consume", async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("untrusted failure"));
          controller.close();
        },
        cancel() {
          cancelled = true;
        },
      }),
      { status: 503 },
    );
  try {
    const result = await internals.fetchJson(
      "https://example.test",
      "/unavailable",
      100,
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, "HTTP 503");
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSON response reads enforce their byte limit with and without content-length", async () => {
  let cancelled = false;
  const streamed = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{}"));
        controller.enqueue(new TextEncoder().encode("{}"));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(
    internals.readResponseText(streamed, 3),
    /exceeded the 3-byte limit/u,
  );
  assert.equal(cancelled, true);

  const declared = new Response("{}", {
    headers: { "content-length": "4" },
  });
  await assert.rejects(
    internals.readResponseText(declared, 3),
    /exceeded the 3-byte limit/u,
  );
});

test("polling failures best-effort cancel an accepted optimization job", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/jobs" && init?.method === "POST") {
      return Response.json(
        { jobId: "job-1", status: "queued" },
        { status: 202 },
      );
    }
    if (url.pathname === "/jobs/job-1" && init?.method !== "POST") {
      return Response.json({ detail: "unavailable" }, { status: 503 });
    }
    if (url.pathname === "/jobs/job-1/cancel" && init?.method === "POST") {
      throw new Error("cancel cleanup failed");
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    await assert.rejects(
      internals.runPortfolioOptimizationJob(
        "https://compute.example.test",
        internals.buildPortfolioOptimizationInput({
          objective: "min_variance",
          maxWeight: null,
          maxTurnover: null,
        }),
        100,
      ),
      /job fetch failed: HTTP 503/u,
    );
    assert.deepEqual(requests, [
      "POST /jobs",
      "GET /jobs/job-1",
      "POST /jobs/job-1/cancel",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const failure of ["malformed JSON", "fetch exception"] as const) {
  test(`a ${failure} while polling still cancels the accepted job`, async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/jobs" && init?.method === "POST") {
        return Response.json(
          { jobId: "job-1", status: "queued" },
          { status: 202 },
        );
      }
      if (url.pathname === "/jobs/job-1" && init?.method !== "POST") {
        if (failure === "malformed JSON") return new Response("{");
        throw new Error("poll exploded");
      }
      if (url.pathname === "/jobs/job-1/cancel" && init?.method === "POST") {
        return Response.json({ jobId: "job-1", status: "cancelled" });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    try {
      await assert.rejects(
        internals.runPortfolioOptimizationJob(
          "https://compute.example.test",
          internals.buildPortfolioOptimizationInput({
            objective: "min_variance",
            maxWeight: null,
            maxTurnover: null,
          }),
          100,
        ),
        failure === "malformed JSON" ? /Invalid JSON/u : /poll exploded/u,
      );
      assert.deepEqual(requests, [
        "POST /jobs",
        "GET /jobs/job-1",
        "POST /jobs/job-1/cancel",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("a polling timeout cancels the accepted job", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/jobs" && init?.method === "POST") {
      return Response.json(
        { jobId: "job-1", status: "queued" },
        { status: 202 },
      );
    }
    if (url.pathname === "/jobs/job-1" && init?.method !== "POST") {
      return Response.json({ jobId: "job-1", status: "running" });
    }
    if (url.pathname === "/jobs/job-1/cancel" && init?.method === "POST") {
      return Response.json({ jobId: "job-1", status: "cancelled" });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    await assert.rejects(
      internals.runPortfolioOptimizationJob(
        "https://compute.example.test",
        internals.buildPortfolioOptimizationInput({
          objective: "min_variance",
          maxWeight: null,
          maxTurnover: null,
        }),
        100,
      ),
      /timed out after 100ms/u,
    );
    assert.equal(requests[0], "POST /jobs");
    assert.equal(requests.at(-1), "POST /jobs/job-1/cancel");
    assert.ok(requests.includes("GET /jobs/job-1"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("poll requests cannot outlive the remaining job deadline", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname === "/jobs" && init?.method === "POST") {
      return Response.json(
        { jobId: "job-1", status: "queued" },
        { status: 202 },
      );
    }
    if (url.pathname === "/jobs/job-1" && init?.method !== "POST") {
      return await new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(
          () => resolve(Response.json({ jobId: "job-1", status: "running" })),
          220,
        );
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
    if (url.pathname === "/jobs/job-1/cancel" && init?.method === "POST") {
      return Response.json({ jobId: "job-1", status: "cancelled" });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  const startedAt = performance.now();
  try {
    await assert.rejects(
      internals.runPortfolioOptimizationJob(
        "https://compute.example.test",
        internals.buildPortfolioOptimizationInput({
          objective: "min_variance",
          maxWeight: null,
          maxTurnover: null,
        }),
        100,
      ),
      /(?:timeout|timed out) after/u,
    );
    assert.ok(
      performance.now() - startedAt < 180,
      `poll outlived the deadline by ${Math.round(performance.now() - startedAt - 100)}ms`,
    );
    assert.equal(requests.at(-1), "POST /jobs/job-1/cancel");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

for (const status of ["completed", "failed", "cancelled"] as const) {
  test(`terminal ${status} optimization jobs are not cancelled`, async () => {
    const originalFetch = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
      if (url.pathname === "/jobs" && init?.method === "POST") {
        return Response.json(
          { jobId: "job-1", status: "queued" },
          { status: 202 },
        );
      }
      if (url.pathname === "/jobs/job-1" && init?.method !== "POST") {
        return Response.json({
          jobId: "job-1",
          status,
          result: status === "completed" ? { advisoryOnly: true } : null,
          error:
            status === "failed" ? { code: "failed", message: "failed" } : null,
        });
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };
    try {
      const result = await internals.runPortfolioOptimizationJob(
        "https://compute.example.test",
        internals.buildPortfolioOptimizationInput({
          objective: "min_variance",
          maxWeight: null,
          maxTurnover: null,
        }),
        100,
      );
      assert.equal(result["status"], status);
      assert.deepEqual(requests, ["POST /jobs", "GET /jobs/job-1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test("status rejects malformed or request-mismatched completed results", () => {
  assert.equal(statusExitCode(healthySummary()), 0);

  const missingHealthProof = structuredClone(healthySummary());
  delete (missingHealthProof["pythonCompute"] as Record<string, unknown>)[
    "healthOk"
  ];
  assert.equal(statusExitCode(missingHealthProof), 2);

  const wrongObjective = structuredClone(healthySummary());
  (wrongObjective["portfolioOptimization"] as Record<string, unknown>)[
    "objective"
  ] = "max_return";
  assert.equal(statusExitCode(wrongObjective), 2);

  const wrongService = structuredClone(healthySummary());
  (wrongService["capabilities"] as Record<string, unknown>)["service"] =
    "not-pyrus-compute";
  assert.equal(statusExitCode(wrongService), 2);

  const wrongJobType = structuredClone(healthySummary());
  (wrongJobType["portfolioOptimization"] as Record<string, unknown>)[
    "jobType"
  ] = "portfolio_risk";
  assert.equal(statusExitCode(wrongJobType), 2);

  const missingJobId = structuredClone(healthySummary());
  delete (missingJobId["portfolioOptimization"] as Record<string, unknown>)[
    "jobId"
  ];
  assert.equal(statusExitCode(missingJobId), 2);

  const missingWeight = structuredClone(healthySummary());
  const missingWeightAllocations = (
    missingWeight["portfolioOptimization"] as Record<string, unknown>
  )["allocations"] as Array<Record<string, unknown>>;
  missingWeightAllocations[0]!["proposedWeight"] = null;
  assert.equal(statusExitCode(missingWeight), 2);

  const duplicateSymbol = structuredClone(healthySummary());
  const duplicateAllocations = (
    duplicateSymbol["portfolioOptimization"] as Record<string, unknown>
  )["allocations"] as Array<Record<string, unknown>>;
  duplicateAllocations[0]!["symbol"] = "QQQ";
  assert.equal(statusExitCode(duplicateSymbol), 2);

  const incomplete = structuredClone(healthySummary());
  (incomplete["portfolioOptimization"] as Record<string, unknown>)[
    "allocationCount"
  ] = 0;
  assert.equal(statusExitCode(incomplete), 2);

  const mismatchedConstraints = structuredClone(healthySummary());
  (mismatchedConstraints["portfolioOptimization"] as Record<string, unknown>)[
    "constraints"
  ] = { longOnly: true, maxWeight: 0.4, maxTurnover: null };
  assert.equal(statusExitCode(mismatchedConstraints), 2);

  const inconsistentDelta = structuredClone(healthySummary());
  const inconsistentAllocations = (
    inconsistentDelta["portfolioOptimization"] as Record<string, unknown>
  )["allocations"] as Array<Record<string, unknown>>;
  inconsistentAllocations[0]!["deltaWeight"] = 0;
  assert.equal(statusExitCode(inconsistentDelta), 2);

  const negativeCurrentWeight = structuredClone(healthySummary());
  const negativeCurrentAllocations = (
    negativeCurrentWeight["portfolioOptimization"] as Record<string, unknown>
  )["allocations"] as Array<Record<string, unknown>>;
  negativeCurrentAllocations[0]!["currentWeight"] = -0.1;
  negativeCurrentAllocations[0]!["deltaWeight"] = 0.4;
  assert.equal(statusExitCode(negativeCurrentWeight), 2);

  const missingConcentration = structuredClone(healthySummary());
  delete (
    missingConcentration["portfolioOptimization"] as Record<string, unknown>
  )["concentration"];
  assert.equal(statusExitCode(missingConcentration), 2);
});

test("job summaries retain the optimizer's echoed constraints", () => {
  const summary = summarizePortfolioOptimizationJob({
    result: {
      constraints: {
        longOnly: true,
        maxWeight: 0.4,
        maxTurnover: 0.2,
      },
    },
  });

  assert.deepEqual(summary["constraints"], {
    longOnly: true,
    maxWeight: 0.4,
    maxTurnover: 0.2,
  });
});

test("operator-facing text is bounded, credential-redacted, and terminal-safe", () => {
  const message = internals.errorMessage(
    new Error(
      `https://operator:super-secret@example.test/api \u001b[31mline\nnext\u202e${"x".repeat(2_000)}`,
    ),
  );
  assert.match(message, /https:\/\/\[redacted\]@example\.test\/api/u);
  assert.doesNotMatch(message, /super-secret/u);
  assert.doesNotMatch(
    message,
    /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u,
  );
  assert.ok(message.length <= 1_000);

  const json = internals.jsonText({ message: "before\u202eafter\u001b" }, 2);
  assert.doesNotMatch(json, /[\u001b\u202e]/u);
  assert.match(json, /before\\u202eafter\\u001b/u);
  assert.deepEqual(JSON.parse(json), { message: "before\u202eafter\u001b" });
});
