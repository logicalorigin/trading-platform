import { Router, type IRouter } from "express";
import {
  EvaluateSignalMonitorBody,
  EvaluateSignalMonitorResponse,
  EvaluateSignalMonitorMatrixBody,
  EvaluateSignalMonitorMatrixResponse,
  GetSignalMonitorProfileQueryParams,
  GetSignalMonitorProfileResponse,
  GetSignalMonitorStateQueryParams,
  GetSignalMonitorStateResponse,
  ListSignalMonitorEventsQueryParams,
  ListSignalMonitorEventsResponse,
  UpdateSignalMonitorProfileBody,
  UpdateSignalMonitorProfileResponse,
} from "@workspace/api-zod";
import {
  evaluateSignalMonitor,
  evaluateSignalMonitorMatrix,
  getSignalMonitorProfile,
  getSignalMonitorState,
  listSignalMonitorEvents,
  updateSignalMonitorProfile,
} from "../services/signal-monitor";

const router: IRouter = Router();

router.get("/signal-monitor/profile", async (req, res) => {
  const query = GetSignalMonitorProfileQueryParams.parse(req.query);
  const data = GetSignalMonitorProfileResponse.parse(
    await getSignalMonitorProfile(query),
  );

  res.json(data);
});

router.put("/signal-monitor/profile", async (req, res) => {
  const body = UpdateSignalMonitorProfileBody.parse(req.body);
  const data = UpdateSignalMonitorProfileResponse.parse(
    await updateSignalMonitorProfile(body),
  );

  res.json(data);
});

router.post("/signal-monitor/evaluate", async (req, res) => {
  const body = EvaluateSignalMonitorBody.parse(req.body ?? {});
  const data = EvaluateSignalMonitorResponse.parse(
    await evaluateSignalMonitor(body),
  );

  res.json(data);
});

router.post("/signal-monitor/matrix", async (req, res) => {
  const body = EvaluateSignalMonitorMatrixBody.parse(req.body ?? {});
  const data = EvaluateSignalMonitorMatrixResponse.parse(
    await evaluateSignalMonitorMatrix(body),
  );

  res.json(data);
});

router.get("/signal-monitor/state", async (req, res) => {
  const query = GetSignalMonitorStateQueryParams.parse(req.query);
  const data = GetSignalMonitorStateResponse.parse(
    await getSignalMonitorState(query),
  );

  res.json(data);
});

router.get("/signal-monitor/events", async (req, res) => {
  const query = ListSignalMonitorEventsQueryParams.parse(req.query);
  const data = ListSignalMonitorEventsResponse.parse(
    await listSignalMonitorEvents(query),
  );

  res.json(data);
});

export default router;
