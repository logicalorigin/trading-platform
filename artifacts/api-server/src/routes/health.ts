import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();
export const HEALTH_INSTANCE_HEADER = "x-pyrus-health-instance";
const healthInstanceId = randomUUID();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.setHeader(HEALTH_INSTANCE_HEADER, healthInstanceId);
  res.json(data);
});

export default router;
