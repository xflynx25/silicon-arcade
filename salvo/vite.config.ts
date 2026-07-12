import { defineConfig } from "vite";
import { leaderboardDevPlugin } from "../scripts/leaderboard-dev-plugin";

export default defineConfig({
  // Relative base so built asset URLs resolve under /<game>/ when the arcade
  // launcher loads /<game>/index.html in an iframe (e.g. on Vercel).
  base: "./",
  plugins: [leaderboardDevPlugin()],
  server: {
    open: false
  }
});
