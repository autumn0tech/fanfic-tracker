/**
 * routes/favAuthors.ts — Express router for favourite author management
 *
 * Endpoints:
 *  GET    /favauthors           — list all favourited author names
 *  POST   /favauthors           — add an author to favourites { author: string }
 *  DELETE /favauthors/:author   — remove an author from favourites (URL-encoded name)
 */

import { Router, type IRouter } from "express";
import { AddFavAuthorBody } from "@workspace/api-zod";
import { listFavAuthors, addFavAuthor, removeFavAuthor } from "../lib/sheetsDb";

const router: IRouter = Router();

// ─── GET /favauthors ─────────────────────────────────────────────────────────
router.get("/favauthors", async (_req, res): Promise<void> => {
  const authors = await listFavAuthors();
  res.json(authors);
});

// ─── POST /favauthors ────────────────────────────────────────────────────────
router.post("/favauthors", async (req, res): Promise<void> => {
  const parsed = AddFavAuthorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await addFavAuthor(parsed.data.author);
  res.sendStatus(201);
});

// ─── DELETE /favauthors/:author ──────────────────────────────────────────────
router.delete("/favauthors/:author", async (req, res): Promise<void> => {
  const author = decodeURIComponent(req.params.author);
  const removed = await removeFavAuthor(author);
  if (!removed) {
    res.status(404).json({ error: "Author not in favourites" });
    return;
  }
  res.sendStatus(204);
});

export default router;
