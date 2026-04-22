import { Router, type IRouter } from "express";
import automationRouter from "./automation";
import backtestingRouter from "./backtesting";
import chartingRouter from "./charting";
import healthRouter from "./health";
import platformRouter from "./platform";
import researchRouter from "./research";

const router: IRouter = Router();

router.use(healthRouter);
router.use(automationRouter);
router.use(backtestingRouter);
router.use(chartingRouter);
router.use(platformRouter);
router.use(researchRouter);

export default router;
