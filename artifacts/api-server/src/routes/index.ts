import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import automationRouter from "./automation";
import authRouter, {
  requireAdmin,
  requireAdminCsrf,
  requireUser,
  requireUserCsrf,
} from "./auth";
import backtestingRouter, {
  BACKTEST_WORKER_RESOLVE_OPTION_PATH,
  isBacktestWorkerServiceRequest,
} from "./backtesting";
import brokerExecutionRouter from "./broker-execution";
import chartingRouter from "./charting";
import diagnosticsRouter from "./diagnostics";
import healthRouter from "./health";
import ibkrPortalRouter from "./ibkr-portal";
import marketingRouter from "./marketing";
import platformRouter from "./platform";
import readinessRouter from "./readiness";
import researchRouter from "./research";
import settingsRouter from "./settings";
import signalMonitorRouter from "./signal-monitor";
import taxRouter from "./tax";

const router: IRouter = Router();

export type ApiSecurityAudience = "public" | "user" | "admin" | "service";
export type ApiAuthentication =
  | "pyrusSessionCookie"
  | "pyrusBacktestWorkerBearer"
  | "pyrusMarketingDashboardBearer"
  | "pyrusIbkrEmbedGrant"
  | "pyrusIbkrEmbedSession"
  | "pyrusGatewayHostHmac";
export type ApiRouteSecurityPolicy = {
  audience: ApiSecurityAudience;
  /** Accepted authentication mechanisms. Multiple values are alternatives. */
  authentication: readonly ApiAuthentication[];
  csrf: boolean;
};

// Public routes are exact and method-aware. Everything else must match an
// authenticated/service policy below or fail closed with 404.
export const PUBLIC_API_ROUTES = [
  ["GET", "/healthz"],
  ["GET", "/auth/session"],
  ["POST", "/auth/bootstrap"],
  ["POST", "/auth/login"],
  ["GET", "/auth/launch"],
  ["POST", "/auth/launch"],
] as const;

const PUBLIC_ROUTE_KEYS = new Set(
  PUBLIC_API_ROUTES.map(([method, path]) => `${method} ${path}`),
);

const SESSION_AUTHENTICATION = ["pyrusSessionCookie"] as const;
const SERVICE_ROUTE_AUTHENTICATION = new Map<
  string,
  readonly ApiAuthentication[]
>([
  [
    `POST ${BACKTEST_WORKER_RESOLVE_OPTION_PATH}`,
    ["pyrusBacktestWorkerBearer"],
  ],
  [
    "GET /marketing/shadow-dashboard/snapshot",
    ["pyrusMarketingDashboardBearer"],
  ],
  [
    "GET /marketing/shadow-dashboard/stream",
    ["pyrusMarketingDashboardBearer"],
  ],
]);
const BACKTEST_BARS_AUTHENTICATION = [
  "pyrusSessionCookie",
  "pyrusBacktestWorkerBearer",
] as const;
const IBKR_PORTAL_CLIENT_PATH =
  /^\/broker-execution\/ibkr-portal\/client(\/|$)/;
const IBKR_PORTAL_GATEWAY_PATH =
  /^\/broker-execution\/ibkr-portal\/gateway(\/|$)/;
const GATEWAY_HOST_LIFECYCLE_PATH =
  /^\/internal\/ibkr\/gateway-hosts\/[^/]+\/(?:register|heartbeat)$/;

const REQUIRE_ADMIN_ROUTE_PATTERNS: Array<{
  method: string;
  path: RegExp;
}> = [
  { method: "GET", path: /^\/broker-execution\/ibkr\/oauth\/readiness$/ },
  { method: "PUT", path: /^\/signal-monitor\/profile$/ },
  { method: "POST", path: /^\/signal-monitor\/evaluate$/ },
  {
    method: "POST",
    path: /^\/broker-execution\/(?:robinhood|snaptrade)\/accounts\/[^/]+\/(?:orders|options)(?:\/impact)?$/,
  },
  {
    method: "POST",
    path: /^\/broker-execution\/snaptrade\/accounts\/[^/]+\/orders\/[^/]+\/replace$/,
  },
];

const OWNER_SCOPED_ALGO_ROUTE_PATTERNS: Array<{
  methods: readonly string[];
  path: RegExp;
}> = [
  { methods: ["GET", "POST"], path: /^\/algo\/deployments$/ },
  { methods: ["GET"], path: /^\/algo\/deployment-accounts$/ },
  { methods: ["GET", "PATCH"], path: /^\/algo\/deployments\/[^/]+$/ },
  {
    methods: ["POST"],
    path: /^\/algo\/deployments\/[^/]+\/(?:archive|restore)$/,
  },
  { methods: ["GET"], path: /^\/algo\/deployments\/[^/]+\/targets$/ },
  {
    methods: ["POST"],
    path: /^\/algo\/deployments\/[^/]+\/targets\/(?:apply|retry)$/,
  },
  {
    methods: ["POST"],
    path: /^\/algo\/deployments\/[^/]+\/targets\/[^/]+\/takeover$/,
  },
];

const REQUIRE_ADMIN_PATHS = [
  // Platform-ops settings (currently unguarded — tightened here).
  /^\/settings\/backend(\/|$)/,
  // These stores have no reliable app_user_id yet. Fail closed instead of
  // exposing one member's data to every other authenticated member.
  /^\/algo(\/|$)/,
  /^\/streams\/algo(\/|$)/,
  /^\/accounts\/flex(\/|$)/,
  /^\/backtests(\/|$)/,
  /^\/charting\/pine-scripts(\/|$)/,
  // Operator diagnostics can contain infrastructure and account metadata.
  /^\/diagnostics(\/|$)/,
];

const REQUIRE_USER_PATHS = [
  /^\/auth\/logout$/,
  /^\/session$/,
  /^\/readiness$/,
  /^\/broker-execution(\/|$)/,
  // platform.ts user-scoped and provider-backed data.
  /^\/broker-connections(\/|$)/,
  /^\/accounts(\/|$)/,
  /^\/positions(\/|$)/,
  /^\/orders(\/|$)/,
  /^\/executions(\/|$)/,
  /^\/watchlists(\/|$)/,
  /^\/shadow\/orders(\/|$)/,
  /^\/quotes(\/|$)/,
  /^\/gex-snapshots(\/|$)/,
  /^\/gex(\/|$)/,
  /^\/options(\/|$)/,
  /^\/news(\/|$)/,
  /^\/universe(\/|$)/,
  /^\/bars(\/|$)/,
  /^\/sparklines(\/|$)/,
  /^\/footprints(\/|$)/,
  /^\/flow(\/|$)/,
  /^\/streams(\/|$)/,
  // Member data routers with distinct prefixes.
  /^\/research(\/|$)/,
  /^\/signal-monitor(\/|$)/,
  // Member settings.
  /^\/settings\/preferences(\/|$)/,
  // Tax profile, tax estimates, and reserve planning are user-scoped.
  /^\/tax(\/|$)/,
];

const USER_NO_CSRF_ROUTE_KEYS = new Set([
  // Read/computation requests use POST only because their bounded inputs do not
  // fit safely in a query string; they do not mutate authoritative state.
  "POST /options/quotes",
  "POST /options/chains/batch",
  "POST /bars/batch",
  "POST /sparklines/seed",
  "POST /flow/scanner/benchmark",
  // Append-only, rate-limited browser telemetry has its own requireUser guard.
  "POST /diagnostics/client-events",
  "POST /diagnostics/client-metrics",
  "POST /diagnostics/browser-reports",
]);
const STOCK_STREAM_SYMBOL_UPDATE_PATH =
  /^\/streams\/stocks\/aggregates\/sessions\/[^/]+\/symbols$/;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeSecurityMethod(method: string): string {
  const normalized = method.toUpperCase();
  return normalized === "HEAD" ? "GET" : normalized;
}

function normalizeSecurityPath(rawPath: string): string {
  const withoutQuery = rawPath.split("?", 1)[0] || "/";
  const withoutApi = withoutQuery.startsWith("/api/")
    ? withoutQuery.slice(4)
    : withoutQuery === "/api"
      ? "/"
      : withoutQuery;
  const normalized = withoutApi.toLowerCase();
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

export function classifyApiSecurityRoute(
  method: string,
  rawPath: string,
): ApiRouteSecurityPolicy | null {
  const normalizedMethod = normalizeSecurityMethod(method);
  const path = normalizeSecurityPath(rawPath);
  const key = `${normalizedMethod} ${path}`;

  if (PUBLIC_ROUTE_KEYS.has(key)) {
    return { audience: "public", authentication: [], csrf: false };
  }
  const serviceAuthentication = SERVICE_ROUTE_AUTHENTICATION.get(key);
  if (serviceAuthentication) {
    return {
      audience: "service",
      authentication: serviceAuthentication,
      csrf: false,
    };
  }
  if (
    normalizedMethod === "POST" &&
    GATEWAY_HOST_LIFECYCLE_PATH.test(path)
  ) {
    return {
      audience: "service",
      authentication: ["pyrusGatewayHostHmac"],
      csrf: false,
    };
  }
  if (IBKR_PORTAL_CLIENT_PATH.test(path)) {
    const authentication =
      normalizedMethod === "GET" &&
      path === "/broker-execution/ibkr-portal/client/authorize"
        ? (["pyrusIbkrEmbedGrant"] as const)
        : (["pyrusIbkrEmbedSession"] as const);
    return { audience: "service", authentication, csrf: false };
  }
  if (IBKR_PORTAL_GATEWAY_PATH.test(path)) {
    // The console proxy requires the app session in its handler, but the
    // gateway-owned login form cannot attach an app CSRF header.
    return {
      audience: "user",
      authentication: SESSION_AUTHENTICATION,
      csrf: false,
    };
  }
  if (normalizedMethod === "GET" && path === "/bars") {
    return {
      audience: "user",
      authentication: BACKTEST_BARS_AUTHENTICATION,
      csrf: false,
    };
  }
  if (USER_NO_CSRF_ROUTE_KEYS.has(key)) {
    return {
      audience: "user",
      authentication: SESSION_AUTHENTICATION,
      csrf: false,
    };
  }

  if (
    OWNER_SCOPED_ALGO_ROUTE_PATTERNS.some(
      (pattern) =>
        pattern.methods.includes(normalizedMethod) && pattern.path.test(path),
    )
  ) {
    return {
      audience: "user",
      authentication: SESSION_AUTHENTICATION,
      csrf: !SAFE_METHODS.has(normalizedMethod),
    };
  }

  const csrf = !SAFE_METHODS.has(normalizedMethod);
  if (
    REQUIRE_ADMIN_ROUTE_PATTERNS.some(
      (pattern) =>
        pattern.method === normalizedMethod && pattern.path.test(path),
    ) ||
    REQUIRE_ADMIN_PATHS.some((pattern) => pattern.test(path))
  ) {
    return {
      audience: "admin",
      authentication: SESSION_AUTHENTICATION,
      csrf,
    };
  }
  if (REQUIRE_USER_PATHS.some((pattern) => pattern.test(path))) {
    const boundedWithoutCsrf =
      normalizedMethod === "POST" &&
      STOCK_STREAM_SYMBOL_UPDATE_PATH.test(path);
    return {
      audience: "user",
      authentication: SESSION_AUTHENTICATION,
      csrf: csrf && !boundedWithoutCsrf,
    };
  }
  return null;
}

function gate(
  guard: (req: Request) => Promise<unknown>,
  req: Request,
  next: NextFunction,
): void {
  guard(req)
    .then(() => next())
    .catch(next);
}

router.use((req: Request, res: Response, next: NextFunction) => {
  const path = normalizeSecurityPath(req.path);
  const policy = classifyApiSecurityRoute(req.method, path);
  if (!policy) {
    res.status(404).json({ title: "Not found", status: 404 });
    return;
  }
  if (policy.audience === "public" || policy.audience === "service") {
    next();
    return;
  }

  // The active worker calls only GET /bars over HTTP and supplies the same
  // dedicated bearer used by the internal backtest route. Browser callers use
  // their normal signed-in session.
  if (
    normalizeSecurityMethod(req.method) === "GET" &&
    path === "/bars" &&
    isBacktestWorkerServiceRequest(req)
  ) {
    next();
    return;
  }

  const guard =
    policy.audience === "admin"
      ? policy.csrf
        ? requireAdminCsrf
        : requireAdmin
      : policy.csrf
        ? requireUserCsrf
        : requireUser;
  gate(guard, req, next);
});

router.use(healthRouter);
router.use(authRouter);
router.use(automationRouter);
router.use(backtestingRouter);
router.use(brokerExecutionRouter);
router.use(ibkrPortalRouter);
router.use(chartingRouter);
router.use(diagnosticsRouter);
router.use(marketingRouter);
router.use(platformRouter);
router.use(readinessRouter);
router.use(researchRouter);
router.use(settingsRouter);
router.use(signalMonitorRouter);
router.use(taxRouter);

export default router;
