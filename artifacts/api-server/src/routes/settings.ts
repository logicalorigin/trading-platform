import { once } from "node:events";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  applyBackendSettings,
  getBackendSettingsSnapshot,
  runBackendSettingsAction,
} from "../services/backend-settings";
import {
  getIbkrLaneArchitecture,
  updateIbkrLaneArchitecture,
} from "../services/ibkr-lanes";
import { getIbkrLineUsageSnapshot } from "../services/ibkr-line-usage";
import {
  getUserPreferencesSnapshot,
  updateUserPreferencesSnapshot,
} from "../services/user-preferences";

const router: IRouter = Router();
const IBKR_LINE_USAGE_ROUTE_CACHE_TTL_MS = 2_000;

type IbkrLineUsageRouteSnapshot = Awaited<
  ReturnType<typeof getIbkrLineUsageSnapshot>
>;

let ibkrLineUsageRouteCache: {
  snapshot: IbkrLineUsageRouteSnapshot;
  expiresAt: number;
} | null = null;
let ibkrLineUsageRouteInFlight: Promise<IbkrLineUsageRouteSnapshot> | null = null;

async function getCachedIbkrLineUsageSnapshot(): Promise<IbkrLineUsageRouteSnapshot> {
  const now = Date.now();
  if (ibkrLineUsageRouteCache && ibkrLineUsageRouteCache.expiresAt > now) {
    return ibkrLineUsageRouteCache.snapshot;
  }
  if (ibkrLineUsageRouteInFlight) {
    return ibkrLineUsageRouteInFlight;
  }
  const request = getIbkrLineUsageSnapshot()
    .then((snapshot) => {
      ibkrLineUsageRouteCache = {
        snapshot,
        expiresAt: Date.now() + IBKR_LINE_USAGE_ROUTE_CACHE_TTL_MS,
      };
      return snapshot;
    })
    .finally(() => {
      if (ibkrLineUsageRouteInFlight === request) {
        ibkrLineUsageRouteInFlight = null;
      }
    });
  ibkrLineUsageRouteInFlight = request;
  return request;
}

router.get("/settings/backend", async (_req, res) => {
  res.json(await getBackendSettingsSnapshot());
});

router.post("/settings/backend/apply", async (req, res) => {
  res.json(await applyBackendSettings(req.body ?? {}));
});

router.post("/settings/backend/actions/:actionId", async (req, res) => {
  res.json(await runBackendSettingsAction(req.params.actionId, req.body ?? {}));
});

router.get("/settings/preferences", async (_req, res) => {
  res.json(await getUserPreferencesSnapshot());
});

router.patch("/settings/preferences", async (req, res) => {
  const body =
    req.body && typeof req.body === "object" && "preferences" in req.body
      ? req.body.preferences
      : req.body;
  res.json(await updateUserPreferencesSnapshot(body ?? {}));
});

router.get("/settings/ibkr-lanes", async (_req, res) => {
  res.json(await getIbkrLaneArchitecture());
});

router.put("/settings/ibkr-lanes", async (req, res) => {
  res.json(await updateIbkrLaneArchitecture(req.body ?? {}));
});

router.get("/settings/ibkr-line-usage", async (_req, res) => {
  res.json(await getCachedIbkrLineUsageSnapshot());
});

function writeSseEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function startIbkrLineUsageSse(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  let closed = false;
  let writeInFlight = false;
  const writeSnapshot = async () => {
    if (closed || writeInFlight) {
      return;
    }
    writeInFlight = true;
    try {
      writeSseEvent(res, "ibkr-line-usage", await getCachedIbkrLineUsageSnapshot());
    } catch (error) {
      writeSseEvent(res, "error", {
        message:
          error instanceof Error && error.message
            ? error.message
            : "IBKR line usage stream failed.",
      });
    } finally {
      writeInFlight = false;
    }
  };

  await writeSnapshot();
  const interval = setInterval(writeSnapshot, 2_000);
  req.on("close", () => {
    closed = true;
    clearInterval(interval);
  });
  await once(req, "close");
}

router.get("/settings/ibkr-line-usage/stream", async (req, res) => {
  await startIbkrLineUsageSse(req, res);
});

export default router;
