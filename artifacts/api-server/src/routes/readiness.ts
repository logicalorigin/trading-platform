import { Router, type IRouter } from "express";
import { getLatestDiagnostics } from "../services/diagnostics";
import { buildApiReadinessPayload } from "../services/readiness";

const router: IRouter = Router();

router.get("/readiness", (_req, res) => {
  res.json(
    buildApiReadinessPayload({
      diagnostics: getLatestDiagnostics(),
    }),
  );
});

export default router;
