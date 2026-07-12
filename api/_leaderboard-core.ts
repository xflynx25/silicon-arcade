// Pure, environment-free leaderboard logic shared by BOTH the production
// serverless function (api/leaderboard.ts, backed by Vercel Blob) and the local
// dev middleware (scripts/leaderboard-dev-plugin.ts, backed by a .data/ file).
// Keep this file free of any Node/Vercel imports so both can use it verbatim.
//
// Files/dirs in /api that start with "_" are treated as helpers by Vercel and
// are NOT deployed as their own HTTP endpoints.

export type LeaderboardEntry = { name: string; score: number; date: string };
export type LeaderboardBoard = { game: string; board: string; entries: LeaderboardEntry[] };

export const MAX_ENTRIES = 20;
export const NAME_MAX = 8;

// game + board become part of a storage key, so keep them to a safe slug charset.
const ID_RE = /^[a-z0-9-]{1,24}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === "string" && ID_RE.test(value);
}

// Old-arcade style: uppercase A–Z / 0–9, 1–8 chars. Returns null if nothing
// usable survives sanitisation.
export function sanitizeName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, NAME_MAX);
  return cleaned.length >= 1 ? cleaned : null;
}

// Accepts a finite, non-negative score within a sane ceiling; rounds to 2 dp.
export function coerceScore(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1e7) return null;
  return Math.round(n * 100) / 100;
}

export function emptyBoard(game: string, board: string): LeaderboardBoard {
  return { game, board, entries: [] };
}

// Coerce whatever we read from storage into a trustworthy, sorted board.
export function normalizeBoard(data: unknown, game: string, board: string): LeaderboardBoard {
  const rawEntries = (data as { entries?: unknown })?.entries;
  const entries: LeaderboardEntry[] = Array.isArray(rawEntries)
    ? rawEntries
        .map((e) => {
          const rec = e as Record<string, unknown>;
          return {
            name: typeof rec?.name === "string" ? rec.name : "",
            score: Number(rec?.score),
            date: typeof rec?.date === "string" ? rec.date : new Date().toISOString()
          };
        })
        .filter((e) => e.name.length > 0 && Number.isFinite(e.score))
    : [];
  return sortTrim({ game, board, entries });
}

export function sortTrim(b: LeaderboardBoard): LeaderboardBoard {
  b.entries.sort((a, z) => z.score - a.score);
  b.entries = b.entries.slice(0, MAX_ENTRIES);
  return b;
}

// Insert an entry, re-sort, trim to the top MAX_ENTRIES. Returns the entry's
// 1-based rank, or null if it didn't make the cut (and was trimmed back off).
export function insertEntry(
  b: LeaderboardBoard,
  entry: LeaderboardEntry
): { board: LeaderboardBoard; rank: number | null } {
  b.entries.push(entry);
  sortTrim(b);
  const idx = b.entries.indexOf(entry);
  return { board: b, rank: idx >= 0 ? idx + 1 : null };
}

export function blobKey(game: string, board: string): string {
  return `leaderboards/${game}__${board}.json`;
}
