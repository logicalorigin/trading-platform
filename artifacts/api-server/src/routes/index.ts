import { Router, type IRouter } from "express";
import automationRouter from "./automation";
import authRouter from "./auth";
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
