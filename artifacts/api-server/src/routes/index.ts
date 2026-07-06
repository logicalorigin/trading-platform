import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import automationRouter from "./automation";
import authRouter, { requireAdmin, requireUser } from "./auth";
import backtestingRouter from "./backtesting";
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

const router: IRouter = Router();

// --- Slice 2: authenticate data reads so anonymous callers can no longer read
// platform data. AUTHN ONLY — per-user row scoping lands in Slice 5.
//
// Gating is by PATH PATTERN (not by wrapping router mounts): `router.use(mw,
// subRouter)` does NOT scope mw to subRouter — Express runs mw for every request
// that reaches the layer, which would wrongly gate readiness, marketing, and the
// IBKR helper/desktop/bridge M2M endpoints. Matching explicit prefixes keeps
// those — plus health, auth, inbound telemetry, boot, and platform's /ibkr/* +
// /session + shared /streams/* — public.
//
// The frontend login gate is Slice 8; until then the app requires signing in via
// the header widget and anonymous/headless requests to gated routes get 401.

const REQUIRE_ADMIN_PATHS = [
  // Platform-ops settings (currently unguarded — tightened here).
  /^\/settings\/(backend|ibkr-lanes|ibkr-line-usage)(\/|$)/,
];

const REQUIRE_USER_PATHS = [
  // platform.ts user-scoped data (mixed router — gate only these paths).
  /^\/broker-connections(\/|$)/,
  /^\/accounts(\/|$)/,
  /^\/positions(\/|$)/,
  /^\/orders(\/|$)/,
  /^\/watchlists(\/|$)/,
  /^\/shadow\/orders(\/|$)/,
  // Per-user shadow (paper-trading) SSE streams (Slice 5.5): these reach shadow
  // account readers per-connection and must be scoped to the authenticated caller.
  // (/streams/accounts — the IBKR bridge snapshot — stays public; it has no shadow reader.)
  /^\/streams\/accounts\/page(\/|$)/,
  /^\/streams\/accounts\/shadow(\/|$)/,
  // Member data routers (distinct prefixes; mutations still call requireAdminCsrf).
  /^\/algo(\/|$)/,
  /^\/streams\/algo(\/|$)/,
  /^\/backtests(\/|$)/,
  /^\/charting(\/|$)/,
  /^\/research(\/|$)/,
  /^\/signal-monitor(\/|$)/,
  // Member settings.
  /^\/settings\/preferences(\/|$)/,
];

function gate(
  guard: (req: Request) => Promise<unknown>,
  req: Request,
  next: NextFunction,
): void {
  guard(req)
    .then(() => next())
    .catch(next);
}

router.use((req: Request, _res: Response, next: NextFunction) => {
  const path = req.path;
  if (REQUIRE_ADMIN_PATHS.some((pattern) => pattern.test(path))) {
    gate(requireAdmin, req, next);
    return;
  }
  if (REQUIRE_USER_PATHS.some((pattern) => pattern.test(path))) {
    gate(requireUser, req, next);
    return;
  }
  next();
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

export default router;
