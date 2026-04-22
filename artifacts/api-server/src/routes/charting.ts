import { Router, type IRouter } from "express";
import {
  CreatePineScriptBody,
  ListPineScriptsResponse,
  UpdatePineScriptBody,
  UpdatePineScriptParams,
  UpdatePineScriptResponse,
} from "@workspace/api-zod";
import {
  createPineScript,
  listPineScripts,
  updatePineScript,
} from "../services/pine-scripts";

const router: IRouter = Router();

router.get("/charting/pine-scripts", async (_req, res): Promise<void> => {
  const data = ListPineScriptsResponse.parse(await listPineScripts());
  res.json(data);
});

router.post("/charting/pine-scripts", async (req, res): Promise<void> => {
  const body = CreatePineScriptBody.parse(req.body);
  const data = UpdatePineScriptResponse.parse(await createPineScript(body));
  res.status(201).json(data);
});

router.patch(
  "/charting/pine-scripts/:scriptId",
  async (req, res): Promise<void> => {
    const params = UpdatePineScriptParams.parse(req.params);
    const body = UpdatePineScriptBody.parse(req.body);
    const data = UpdatePineScriptResponse.parse(
      await updatePineScript(params.scriptId, body),
    );
    res.json(data);
  },
);

export default router;
