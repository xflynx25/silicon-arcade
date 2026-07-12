// Tiny, dependency-free leaderboard client. Talks to /api/leaderboard, which is
// same-origin whether the game runs inside the arcade iframe (prod: Vercel Blob;
// dev: local .data file). Every call fails soft — a dead endpoint must never
// break the game, only hide the leaderboard.
//
// Self-contained on purpose: other games can copy this file and call it with
// their own game id / board / metric.

export type LeaderboardEntry = { name: string; score: number; date: string };
export type SubmitResult = { entries: LeaderboardEntry[]; rank: number | null; qualified: boolean };

export const MAX_ENTRIES = 20;

const ENDPOINT = "/api/leaderboard";
// Optional shared secret, baked in at build time (set VITE_LEADERBOARD_TOKEN).
const TOKEN = (import.meta as any).env?.VITE_LEADERBOARD_TOKEN as string | undefined;

export async function getLeaderboard(game: string, board: string): Promise<LeaderboardEntry[]> {
  try {
    const res = await fetch(
      `${ENDPOINT}?game=${encodeURIComponent(game)}&board=${encodeURIComponent(board)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.entries) ? (data.entries as LeaderboardEntry[]) : [];
  } catch {
    return [];
  }
}

export async function submitScore(
  game: string,
  board: string,
  name: string,
  score: number
): Promise<SubmitResult | null> {
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(TOKEN ? { "x-arcade-token": TOKEN } : {})
      },
      body: JSON.stringify({ game, board, name, score })
    });
    if (!res.ok) return null;
    return (await res.json()) as SubmitResult;
  } catch {
    return null;
  }
}

// Would this score make the board? (board is assumed already sorted desc.)
export function qualifies(entries: LeaderboardEntry[], score: number): boolean {
  if (score <= 0) return false;
  if (entries.length < MAX_ENTRIES) return true;
  return score > entries[entries.length - 1].score;
}
