import { Router, type IRouter } from "express";
import {
  ScrapeFicBody,
  GetFicParams,
  UpdateFicParams,
  UpdateFicBody,
  DeleteFicParams,
  CreateFicBody,
  ListFicsResponse,
  GetFicResponse,
  UpdateFicResponse,
  ScrapeFicResponse,
  GetMonthlyStatsResponse,
} from "@workspace/api-zod";
import { scrapeFic, validateAO3Url } from "../lib/scraper";
import {
  listFics,
  getFic,
  createFic,
  updateFic,
  deleteFic,
  getMonthlyStats,
} from "../lib/sheetsDb";

const router: IRouter = Router();

router.post("/fics/scrape", async (req, res): Promise<void> => {
  const parsed = ScrapeFicBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { url } = parsed.data;

  if (!validateAO3Url(url)) {
    res
      .status(400)
      .json({ error: "Only archiveofourown.org work URLs are supported" });
    return;
  }

  try {
    const scraped = await scrapeFic(url);
    res.json(ScrapeFicResponse.parse(scraped));
  } catch (err) {
    req.log.warn({ err }, "AO3 scrape failed");
    res
      .status(400)
      .json({ error: err instanceof Error ? err.message : "Scrape failed" });
  }
});

router.get("/fics", async (_req, res): Promise<void> => {
  const fics = await listFics();
  res.json(ListFicsResponse.parse(fics));
});

router.post("/fics", async (req, res): Promise<void> => {
  const parsed = CreateFicBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const fic = await createFic(parsed.data);
  res.status(201).json(GetFicResponse.parse(fic));
});

router.get("/fics/:id", async (req, res): Promise<void> => {
  const params = GetFicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const fic = await getFic(params.data.id);
  if (!fic) {
    res.status(404).json({ error: "Fic not found" });
    return;
  }

  res.json(GetFicResponse.parse(fic));
});

router.patch("/fics/:id", async (req, res): Promise<void> => {
  const params = UpdateFicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = UpdateFicBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const fic = await updateFic(params.data.id, body.data);
  if (!fic) {
    res.status(404).json({ error: "Fic not found" });
    return;
  }

  res.json(UpdateFicResponse.parse(fic));
});

router.delete("/fics/:id", async (req, res): Promise<void> => {
  const params = DeleteFicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const deleted = await deleteFic(params.data.id);
  if (!deleted) {
    res.status(404).json({ error: "Fic not found" });
    return;
  }

  res.sendStatus(204);
});

router.get("/stats/monthly", async (_req, res): Promise<void> => {
  const stats = await getMonthlyStats();
  res.json(GetMonthlyStatsResponse.parse(stats));
});

export default router;
