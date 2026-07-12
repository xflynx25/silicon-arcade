import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so built asset URLs resolve under /<game>/ when the
  // arcade launcher loads /<game>/index.html in an iframe (e.g. on Vercel).
  base: "./",
  server: {
    open: false
  }
});
