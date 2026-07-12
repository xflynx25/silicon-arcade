// Copies each game's built dist/ into the root dist/<game>/ so the arcade
// launcher's iframe requests (e.g. /nova/index.html) resolve in production.
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const games = ["tether", "polarity", "ricochet", "echo", "vortex", "nova", "lattice", "salvo"];

for (const game of games) {
  const src = path.join(root, game, "dist");
  const dest = path.join(root, "dist", game);
  if (!existsSync(src)) {
    throw new Error(`Missing build output for "${game}": ${src}`);
  }
  cpSync(src, dest, { recursive: true });
}
