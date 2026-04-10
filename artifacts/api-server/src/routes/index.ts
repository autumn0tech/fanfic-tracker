import { Router, type IRouter } from "express";
import healthRouter from "./health";
import ficsRouter from "./fics";
import favAuthorsRouter from "./favAuthors";

const router: IRouter = Router();

router.use(healthRouter);
router.use(ficsRouter);
router.use(favAuthorsRouter);

export default router;
