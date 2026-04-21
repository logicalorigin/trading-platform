import { Router, type IRouter } from "express";
import backtestingRouter from "./backtesting";
import healthRouter from "./health";
import platformRouter from "./platform";
import researchRouter from "./research";

const router: IRouter = Router();

router.use(healthRouter);
router.use(backtestingRouter);
router.use(platformRouter);
router.use(researchRouter);

export default router;
