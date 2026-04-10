import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ficsRouter from "./fics";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ficsRouter);

export default router;
