// Local analogue of the production /api/leaderboard function.
//
// Vite's dev/preview servers don't run Vercel serverless functions, so this
// plugin serves the exact same GET/POST contract from a local JSON file under
// ./.data/leaderboards/ (gitignored). It reuses the shared pure logic in
// api/_leaderboard-core.ts so dev and prod behave identically.
//
// Wired into both the root arcade config (pnpm dev) and each game's own config
// (pnpm dev:<game>), so /api/leaderboard resolves whichever way you run.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Connect, Plugin } from "vite";
import {
  coerceScore,
  emptyBoard,
  insertEntry,
  isValidId,
  MAX_ENTRIES,
  normalizeBoard,
  sanitizeName,
  type LeaderboardBoard
} from "../api/_leaderboard-core";

export function leaderboardDevPlugin(): Plugin {
  const dataDir = path.resolve(process.cwd(), ".data", "leaderboards");
  const fileFor = (game: string, board: string): string =>
    path.join(dataDir, `${game}__${board}.json`);

  async function read(game: string, board: string): Promise<LeaderboardBoard> {
    try {
      const raw = await fs.readFile(fileFor(game, board), "utf8");
      return normalizeBoard(JSON.parse(raw), game, board);
    } catch {
      return emptyBoard(game, board);
    }
  }

  async function write(b: LeaderboardBoard): Promise<void> {
    await fs.mkdir(dataDir, { recursive: true });
    await fs.writeFile(fileFor(b.game, b.board), JSON.stringify(b, null, 2));
  }

  const middleware: Connect.NextHandleFunction = async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/leaderboard")) {
      next();
      return;
    }
    try {
      const parsed = new URL(url, "http://localhost");
      if (req.method === "GET") {
        const game = parsed.searchParams.get("game") ?? "";
        const board = parsed.searchParams.get("board") ?? "default";
        if (!isValidId(game) || !isValidId(board)) return json(res, 400, { error: "invalid game/board" });
        const b = await read(game, board);
        return json(res, 200, { enabled: true, entries: b.entries, max: MAX_ENTRIES });
      }
      if (req.method === "POST") {
        const body = await readJsonBody(req);
        const game = body.game;
        const board = body.board ?? "default";
        if (!isValidId(game) || !isValidId(board)) return json(res, 400, { error: "invalid game/board" });
        const name = sanitizeName(body.name);
        const score = coerceScore(body.score);
        if (!name || score === null) return json(res, 400, { error: "invalid name/score" });
        const current = await read(game, board);
        const entry = { name, score, date: new Date().toISOString() };
        const { board: updated, rank } = insertEntry(current, entry);
        await write(updated);
        return json(res, 200, { enabled: true, entries: updated.entries, rank, qualified: rank !== null, max: MAX_ENTRIES });
      }
      return json(res, 405, { error: "method not allowed" });
    } catch {
      return json(res, 500, { error: "server error" });
    }
  };

  return {
    name: "arcade-leaderboard-dev",
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    }
  };
}

function json(res: any, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function readJsonBody(req: any): Promise<Record<string, any>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk: Buffer) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}
