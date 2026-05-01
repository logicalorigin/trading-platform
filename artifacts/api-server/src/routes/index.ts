import { Router, type IRouter } from "express";
import automationRouter from "./automation";
import backtestingRouter from "./backtesting";
import chartingRouter from "./charting";
import diagnosticsRouter from "./diagnostics";
import healthRouter from "./health";
import platformRouter from "./platform";
import researchRouter from "./research";
import settingsRouter from "./settings";
import signalMonitorRouter from "./signal-monitor";

const router: IRouter = Router();

router.use(healthRouter);
router.use(automationRouter);
router.use(backtestingRouter);
router.use(chartingRouter);
router.use(diagnosticsRouter);
router.use(platformRouter);
router.use(researchRouter);
router.use(settingsRouter);
router.use(signalMonitorRouter);

export default router;
