import { defineConfig } from "vite";
import { leaderboardDevPlugin } from "./scripts/leaderboard-dev-plugin";

// Arcade launcher dev server.
//
// Root is the repo, so a single Vite server serves the landing page at "/"
// and every game at "/<game>/" (each game keeps its own index.html + src).
// The launcher boots a game inside an iframe; removing that iframe tears down
// the game's entire JS realm (RAF loops, listeners, AudioContext, timers),
// so every launch is a clean start. Games still run standalone via
// `pnpm dev:<game>` because their index.html now uses a relative script src.
export default defineConfig({
  // Serves /api/leaderboard from a local .data/ file so the leaderboard works
  // in `pnpm dev` exactly as it does on Vercel (Blob) in production.
  plugins: [leaderboardDevPlugin()],
  server: {
    open: false
  }
});
