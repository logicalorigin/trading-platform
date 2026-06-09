import { Router, type IRouter } from "express";
import { getLatestDiagnostics } from "../services/diagnostics";
import { getSession } from "../services/platform";
import { buildApiReadinessPayload } from "../services/readiness";

const router: IRouter = Router();

router.get("/readiness", async (_req, res) => {
  let brokerRuntime: unknown;
  try {
    const session = await getSession();
    brokerRuntime = session.ibkrBridge;
  } catch {
    brokerRuntime = undefined;
  }
  res.json(
    buildApiReadinessPayload({
      brokerRuntime,
      diagnostics: getLatestDiagnostics(),
    }),
  );
});

export default router;
