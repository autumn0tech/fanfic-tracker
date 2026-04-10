/**
 * routes/fics.ts — Express router for all fic-related API endpoints
 *
 * Every request body and param is validated with Zod schemas from
 * @workspace/api-zod before touching the database.  Responses are also
 * parsed through those schemas to guarantee the shape matches the
 * generated client types.
 *
 * Endpoints:
 *  GET    /fics             — list all fics, newest first
 *  POST   /fics             — create a new fic record (called by the bookmarklet redirect)
 *  GET    /fics/:id         — get a single fic by ID
 *  PATCH  /fics/:id         — update userRating and/or userNote
 *  DELETE /fics/:id         — permanently delete a fic
 *  GET    /stats/monthly    — reading stats for the current calendar month
 */

import { Router, type IRouter } from "express";
import {
  GetFicParams,
  UpdateFicParams,
  UpdateFicBody,
  DeleteFicParams,
  CreateFicBody,
  ListFicsResponse,
  GetFicResponse,
  UpdateFicResponse,
  GetMonthlyStatsResponse,
} from "@workspace/api-zod";
import {
  listFics,
  getFic,
  createFic,
  updateFic,
  deleteFic,
  getMonthlyStats,
} from "../lib/sheetsDb";

const router: IRouter = Router();

// ─── GET /fics ───────────────────────────────────────────────────────────────
// Returns the full reading log sorted newest-first.
router.get("/fics", async (_req, res): Promise<void> => {
  const fics = await listFics();
  res.json(ListFicsResponse.parse(fics));
});

// ─── POST /fics ──────────────────────────────────────────────────────────────
// Creates a new fic record.  This is the endpoint the bookmarklet redirect
// triggers — the app detects ?import=<json> on load, decodes it, and POSTs here.
router.post("/fics", async (req, res): Promise<void> => {
  const parsed = CreateFicBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const fic = await createFic(parsed.data);
  res.status(201).json(GetFicResponse.parse(fic));
});

// ─── GET /fics/:id ───────────────────────────────────────────────────────────
// Returns a single fic by its UUID.
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

// ─── PATCH /fics/:id ─────────────────────────────────────────────────────────
// Updates the user's rating and/or note for a fic.
// Only userRating and userNote are editable; all other fields are immutable.
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

// ─── DELETE /fics/:id ────────────────────────────────────────────────────────
// Permanently removes the fic row from the spreadsheet (deleteDimension, not clear).
// Returns 204 No Content on success.
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

// ─── GET /stats/monthly ──────────────────────────────────────────────────────
// Returns ficCount, fandomCount, totalWords, and the current month string ("YYYY-MM").
// Used by the Home page header stats card.
router.get("/stats/monthly", async (_req, res): Promise<void> => {
  const stats = await getMonthlyStats();
  res.json(GetMonthlyStatsResponse.parse(stats));
});

export default router;
