import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import test from "node:test";

import app from "../app";
import {
  createIbkrGatewayHostLifecycleRouter,
  IBKR_GATEWAY_HOSTS_MOUNT,
} from "./ibkr-gateway-hosts";
import apiRouter, {
  classifyApiSecurityRoute,
  PUBLIC_API_ROUTES,
  type ApiRouteSecurityPolicy,
} from "./index";

type ExpressLayer = {
  handle?: { stack?: ExpressLayer[] };
  route?: {
    methods?: Record<string, boolean>;
    path?: string | string[];
  };
};

type OpenApiOperation = {
  block: string;
  method: string;
  path: string;
};

const openApiSource = readFileSync(
  new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
  "utf8",
);

function normalizeContractPath(path: string): string {
  return path
    .replace(/:[^/]+/g, "{param}")
    .replace(/\{[^/]+\}/g, "{param}");
}

function operationKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${normalizeContractPath(path)}`;
}

function collectRouterOperations(
  stack: ExpressLayer[] | undefined,
  pathPrefix = "",
): string[] {
  const operations: string[] = [];
  for (const layer of stack ?? []) {
    if (layer.route?.path && layer.route.methods) {
      const paths = Array.isArray(layer.route.path)
        ? layer.route.path
        : [layer.route.path];
      for (const path of paths) {
        for (const [method, enabled] of Object.entries(layer.route.methods)) {
          if (enabled) operations.push(operationKey(method, `${pathPrefix}${path}`));
        }
      }
      continue;
    }
    if (layer.handle?.stack) {
      operations.push(...collectRouterOperations(layer.handle.stack, pathPrefix));
    }
  }
  return operations;
}

function parseOpenApiOperations(source: string): Map<string, OpenApiOperation> {
  const operations = new Map<string, OpenApiOperation>();
  const lines = source.split("\n");
  let currentPath: string | null = null;
  let currentMethod: string | null = null;
  let blockStart = -1;

  const finishOperation = (end: number): void => {
    if (!currentPath || !currentMethod || blockStart < 0) return;
    const operation = {
      block: lines.slice(blockStart, end).join("\n"),
      method: currentMethod,
      path: currentPath,
    };
    const key = operationKey(currentMethod, currentPath);
    assert.equal(operations.has(key), false, `duplicate OpenAPI operation ${key}`);
    operations.set(key, operation);
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "components:") {
      finishOperation(index);
      break;
    }
    const pathMatch = /^  (\/[^:]+):\s*$/.exec(line);
    if (pathMatch) {
      finishOperation(index);
      currentPath = pathMatch[1] ?? null;
      currentMethod = null;
      blockStart = -1;
      continue;
    }
    const methodMatch = /^    (get|post|put|patch|delete|head|options):\s*$/.exec(
      line,
    );
    if (currentPath && methodMatch) {
      finishOperation(index);
      currentMethod = methodMatch[1] ?? null;
      blockStart = index;
    }
  }
  return operations;
}

async function withServer<T>(fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${address.port}/api`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("route security policy has an exact public list and explicit CSRF decisions", () => {
  assert.deepEqual(PUBLIC_API_ROUTES, [
    ["GET", "/healthz"],
    ["GET", "/auth/session"],
    ["POST", "/auth/bootstrap"],
    ["POST", "/auth/login"],
    ["GET", "/auth/launch"],
    ["POST", "/auth/launch"],
  ]);

  const cases: Array<
    [string, string, ApiRouteSecurityPolicy | null]
  > = [
    [
      "GET",
      "/auth/launch",
      { audience: "public", authentication: [], csrf: false },
    ],
    [
      "GET",
      "/api/session",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/readiness",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/streams/quotes",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/options/quotes",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/options/chains/batch",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/bars/batch",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/sparklines/seed",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/flow/scanner/benchmark",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/diagnostics/client-events",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/diagnostics/latest",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/streams/stocks/aggregates/sessions/session-id/symbols",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/orders",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    [
      "GET",
      "/backtests/studies",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/backtests/studies",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    [
      "POST",
      "/backtests/internal/resolve-option-contract",
      {
        audience: "service",
        authentication: ["pyrusBacktestWorkerBearer"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/bars",
      {
        audience: "user",
        authentication: [
          "pyrusSessionCookie",
          "pyrusBacktestWorkerBearer",
        ],
        csrf: false,
      },
    ],
    [
      "GET",
      "/marketing/shadow-dashboard/snapshot",
      {
        audience: "service",
        authentication: ["pyrusMarketingDashboardBearer"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/broker-execution/ibkr-portal/client/authorize",
      {
        audience: "service",
        authentication: ["pyrusIbkrEmbedGrant"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/broker-execution/ibkr-portal/client/sso/Dispatcher",
      {
        audience: "service",
        authentication: ["pyrusIbkrEmbedSession"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/broker-execution/ibkr-portal/gateway",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/broker-execution/ibkr-portal/gateway/sso/Dispatcher",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/internal/ibkr/gateway-hosts/host-id/register",
      {
        audience: "service",
        authentication: ["pyrusGatewayHostHmac"],
        csrf: false,
      },
    ],
    [
      "GET",
      "/broker-execution/ibkr/oauth/readiness",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: false,
      },
    ],
    [
      "POST",
      "/broker-execution/robinhood/accounts/account-id/options",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    [
      "POST",
      "/broker-execution/snaptrade/accounts/account-id/orders/order-id/replace",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    [
      "POST",
      "/broker-execution/robinhood/accounts/account-id/options/cancel",
      {
        audience: "user",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    [
      "PUT",
      "/signal-monitor/profile",
      {
        audience: "admin",
        authentication: ["pyrusSessionCookie"],
        csrf: true,
      },
    ],
    ["GET", "/ibkr/desktop/status", null],
    ["GET", "/not-a-route", null],
  ];

  for (const [method, path, expected] of cases) {
    assert.deepEqual(classifyApiSecurityRoute(method, path), expected, path);
  }
});

test("mounted HTTP routes, OpenAPI, and runtime security classification are bidirectionally complete", () => {
  const mainRouterOperations = collectRouterOperations(
    (apiRouter as unknown as { stack?: ExpressLayer[] }).stack,
  );
  assert.ok(mainRouterOperations.length > 0, "Express app route stack is empty");
  const internalRouter = createIbkrGatewayHostLifecycleRouter({
    verifyRequest: () => false,
  }) as unknown as { stack?: ExpressLayer[] };
  const internalPrefix = IBKR_GATEWAY_HOSTS_MOUNT.replace(/^\/api/, "");
  const runtimeOperations = new Set([
    ...mainRouterOperations,
    ...collectRouterOperations(internalRouter.stack, internalPrefix),
  ]);
  const openApiOperations = parseOpenApiOperations(openApiSource);

  const missingFromOpenApi = [...runtimeOperations].filter(
    (key) => !openApiOperations.has(key),
  );
  const missingFromRuntime = [...openApiOperations.keys()].filter(
    (key) => !runtimeOperations.has(key),
  );
  assert.deepEqual(missingFromOpenApi.sort(), []);
  assert.deepEqual(missingFromRuntime.sort(), []);

  const publicRoutes: string[] = [];
  for (const operation of openApiOperations.values()) {
    const concretePath = operation.path.replace(/\{[^/]+\}/g, "test");
    const policy = classifyApiSecurityRoute(operation.method, concretePath);
    assert.ok(
      policy,
      `unclassified ${operation.method.toUpperCase()} ${operation.path}`,
    );
    if (policy.audience === "public") {
      publicRoutes.push(`${operation.method.toUpperCase()} ${operation.path}`);
    }

    const expectedAudience =
      policy.authentication.includes("pyrusSessionCookie") &&
      policy.authentication.includes("pyrusBacktestWorkerBearer")
        ? "[user, service]"
        : policy.audience;
    assert.match(
      operation.block,
      new RegExp(
        `^      x-pyrus-audience: ${expectedAudience.replace(
          /[[\]]/g,
          "\\$&",
        )}$`,
        "m",
      ),
      `${operation.method.toUpperCase()} ${operation.path} audience`,
    );

    if (policy.authentication.length === 0) {
      assert.match(
        operation.block,
        /^      security: \[\]$/m,
        `${operation.method.toUpperCase()} ${operation.path} public security`,
      );
    } else if (
      policy.authentication.length !== 1 ||
      policy.authentication[0] !== "pyrusSessionCookie"
    ) {
      for (const scheme of policy.authentication) {
        assert.match(
          operation.block,
          new RegExp(`^        - ${scheme}: \\[\\]$`, "m"),
          `${operation.method.toUpperCase()} ${operation.path} ${scheme}`,
        );
      }
    }

    if (!policy.csrf && !["get", "head", "options"].includes(operation.method)) {
      assert.match(
        operation.block,
        /^      x-pyrus-csrf: not-required$/m,
        `${operation.method.toUpperCase()} ${operation.path} CSRF exception`,
      );
    }

    if (operation.block.includes("text/event-stream:")) {
      assert.match(
        operation.block,
        /^      tags: \[[^\]]*\bclient-streaming\b[^\]]*\]$/m,
        `${operation.method.toUpperCase()} ${operation.path} streaming tag`,
      );
    }
  }

  assert.deepEqual(
    publicRoutes.sort(),
    PUBLIC_API_ROUTES.map(([method, path]) => `${method} ${path}`).sort(),
  );
});

test("OpenAPI declares a first-party, fail-closed authentication convention", () => {
  assert.match(
    openApiSource,
    /description: First-party PYRUS application API\./,
  );
  assert.match(
    openApiSource,
    /^security:\n  - pyrusSessionCookie: \[\]$/m,
  );
  for (const scheme of [
    "pyrusSessionCookie",
    "pyrusBacktestWorkerBearer",
    "pyrusMarketingDashboardBearer",
    "pyrusIbkrEmbedGrant",
    "pyrusIbkrEmbedSession",
    "pyrusGatewayHostHmac",
  ]) {
    assert.match(openApiSource, new RegExp(`^    ${scheme}:$`, "m"), scheme);
  }
  assert.match(openApiSource, /^  defaultAudience: user$/m);
  assert.match(openApiSource, /^  unclassifiedRoutes: deny$/m);
  assert.match(openApiSource, /^  unsafeSessionMethodsRequireCsrf: true$/m);
  for (const surface of [
    "path: /ws/options/quotes",
    "path: /broker-execution/ibkr-portal/gateway",
    "pathPrefix: /broker-execution/ibkr-portal/gateway",
    "pathPrefix: /broker-execution/ibkr-portal/client",
  ]) {
    assert.match(openApiSource, new RegExp(`^      - ${surface}$`, "m"));
  }
});

test("public, protected, capability, and unknown routes reach the intended boundary", async () => {
  await withServer(async (baseUrl) => {
    assert.equal((await fetch(`${baseUrl}/healthz`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/auth/session`)).status, 200);
    assert.equal((await fetch(`${baseUrl}/auth/launch`)).status, 405);

    for (const [method, path, body] of [
      ["GET", "/session", undefined],
      ["GET", "/readiness", undefined],
      ["GET", "/quotes/snapshot", undefined],
      ["GET", "/streams/quotes?symbols=AAPL", undefined],
      ["POST", "/options/quotes", "{}"],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body
          ? { headers: { "content-type": "application/json" }, body }
          : {}),
      });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "auth_required",
        `${method} ${path}`,
      );
    }

    const capabilityResponse = await fetch(
      `${baseUrl}/broker-execution/ibkr-portal/client/authorize`,
    );
    assert.equal(capabilityResponse.status, 401);
    assert.equal(
      ((await capabilityResponse.json()) as { code?: string }).code,
      "ibkr_portal_embed_grant_invalid",
    );

    assert.equal((await fetch(`${baseUrl}/not-a-route`)).status, 404);
  });
});

test("execution and account stream routes reject unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/executions",
      "/streams/orders",
      "/streams/executions",
      "/streams/accounts",
      "/ExEcUtIoNs",
      "/StReAmS/OrDeRs",
      "/StReAmS/ExEcUtIoNs",
      "/StReAmS/AcCoUnTs",
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status !== 401) {
        await response.body?.cancel();
      }
      assert.equal(response.status, 401, path);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "auth_required",
        path,
      );
    }
  });
});

test("flow scanner benchmark rejects unauthenticated requests", async () => {
  await withServer(async (baseUrl) => {
    for (const path of [
      "/flow/scanner/benchmark",
      "/FlOw/ScAnNeR/BeNcHmArK",
    ]) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      assert.equal(response.status, 401, path);
      assert.equal(
        ((await response.json()) as { code?: string }).code,
        "auth_required",
        path,
      );
    }
  });
});
