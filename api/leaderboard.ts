// Production leaderboard endpoint (Vercel serverless function).
//
//   GET  /api/leaderboard?game=tether&board=normal  -> { entries, max }
//   POST /api/leaderboard  { game, board, name, score } -> { entries, rank, qualified, max }
//
// Storage is ONE public JSON blob per game+board in Vercel Blob — no database.
// Reads pull the blob's JSON; writes replace it in place. This is deliberately
// "a text file in the cloud". For a small friends leaderboard the read-modify-
// write race on simultaneous submits is acceptable.
//
// Requires a Blob store connected to the project (env BLOB_READ_WRITE_TOKEN,
// which Vercel injects automatically once the store is linked). Optionally set
// LEADERBOARD_TOKEN to require a shared secret header on writes.

import { list, put } from "@vercel/blob";
import {
  blobKey,
  coerceScore,
  emptyBoard,
  insertEntry,
  isValidId,
  MAX_ENTRIES,
  normalizeBoard,
  sanitizeName,
  type LeaderboardBoard
} from "./_leaderboard-core";

async function readBoard(game: string, board: string): Promise<LeaderboardBoard> {
  const key = blobKey(game, board);
  try {
    const { blobs } = await list({ prefix: key, limit: 100 });
    const found = blobs.find((b) => b.pathname === key);
    if (!found) return emptyBoard(game, board);
    const res = await fetch(found.url, { cache: "no-store" });
    if (!res.ok) return emptyBoard(game, board);
    return normalizeBoard(await res.json(), game, board);
  } catch {
    return emptyBoard(game, board);
  }
}

async function writeBoard(b: LeaderboardBoard): Promise<void> {
  // Fixed pathname + no random suffix => each write replaces the game's blob.
  await put(blobKey(b.game, b.board), JSON.stringify(b), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false
  });
}

function json(res: any, status: number, body: unknown): void {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.status(status).send(JSON.stringify(body));
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default async function handler(req: any, res: any): Promise<void> {
  const method: string = req.method ?? "GET";

  if (method === "GET") {
    const game = String(req.query?.game ?? "");
    const board = String(req.query?.board ?? "default");
    if (!isValidId(game) || !isValidId(board)) {
      json(res, 400, { error: "invalid game/board" });
      return;
    }
    const b = await readBoard(game, board);
    json(res, 200, { entries: b.entries, max: MAX_ENTRIES });
    return;
  }

  if (method === "POST") {
    const secret = process.env.LEADERBOARD_TOKEN;
    if (secret && req.headers?.["x-arcade-token"] !== secret) {
      json(res, 401, { error: "unauthorized" });
      return;
    }
    const body =
      typeof req.body === "string" ? safeParse(req.body) : (req.body ?? {}) as Record<string, unknown>;
    const game = body.game;
    const board = body.board ?? "default";
    if (!isValidId(game) || !isValidId(board)) {
      json(res, 400, { error: "invalid game/board" });
      return;
    }
    const name = sanitizeName(body.name);
    const score = coerceScore(body.score);
    if (!name || score === null) {
      json(res, 400, { error: "invalid name/score" });
      return;
    }
    const current = await readBoard(game, board);
    const entry = { name, score, date: new Date().toISOString() };
    const { board: updated, rank } = insertEntry(current, entry);
    await writeBoard(updated);
    json(res, 200, { entries: updated.entries, rank, qualified: rank !== null, max: MAX_ENTRIES });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  json(res, 405, { error: "method not allowed" });
}
