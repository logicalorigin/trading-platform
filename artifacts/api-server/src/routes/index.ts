import { Router, type IRouter } from "express";
import healthRouter from "./health";
import platformRouter from "./platform";
import researchRouter from "./research";

const router: IRouter = Router();

router.use(healthRouter);
router.use(platformRouter);
router.use(researchRouter);

export default router;
