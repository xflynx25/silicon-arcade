---
name: Arcade Leaderboards (no external DB)
overview: "Add old-fashioned arcade high-score leaderboards (score + date + player-chosen name, no auth) to selected games starting with TETHER. Persist scores on Vercel WITHOUT Postgres/Neon by using Vercel Blob as a single JSON file per game, served through two tiny zero-config serverless functions. A Vite dev-server middleware backed by a local .data/*.json file provides an identical local analogue so `pnpm dev` just works."
todos:
  - id: storage-adapter
    content: "Shared pure logic in api/_leaderboard-core.ts (validate/sort/trim); Blob backend in api/leaderboard.ts, local-file backend in the dev plugin"
    status: completed
  - id: api-functions
    content: "Add /api/leaderboard serverless functions: GET (list top N for a game) and POST (submit a score, keep top N)"
    status: completed
  - id: local-middleware
    content: "Add a Vite plugin/middleware to root vite.config.ts that serves /api/leaderboard from the local JSON file during `pnpm dev`"
    status: completed
  - id: shared-client
    content: "Add a tiny shared client helper (fetch wrapper) games can import: getLeaderboard(game) and submitScore(game, entry)"
    status: completed
  - id: tether-integration
    content: "Wire TETHER: on run end, check if score qualifies, prompt for a 3-8 char name, submit, and render the leaderboard on the game-over overlay"
    status: completed
  - id: verify
    content: "Typecheck + full build pass. REMAINING (user/manual): create+link Vercel Blob store, deploy, confirm a submitted score survives a redeploy"
    status: pending
isProject: false
---

# Arcade Leaderboards — Simple Storage Plan

## The core question: can we just write a text file in the project on Vercel?

**No — not a file inside the deployed project.** Vercel's runtime filesystem is
read-only. Static hosting has no write path at all, and serverless/edge functions
can only write to `/tmp`, which is **ephemeral** (wiped between invocations, not
shared across instances, gone on redeploy). So "append to `scores.txt` in the repo
at runtime" is impossible.

**But we don't need Postgres/Neon.** The closest thing to "just a file that
persists," staying entirely inside Vercel and free for our volume, is **Vercel
Blob**: we keep **one JSON file per game** and read/replace it. Mental model is
exactly a text file in the cloud.

This repo is currently a **pure static Vite multi-game build** (no backend yet), so
we add a minimal `/api` folder. Vercel deploys functions in `/api` with **zero
config even for a static/Vite project**, and because everything is one Vercel
deployment (arcade at `/`, games at `/tether/`, functions at `/api/`), games can
`fetch('/api/leaderboard')` **same-origin** — no CORS.

## Options considered

| Option | Persists on Vercel? | "No DB" feel | Extra service | Notes |
|---|---|---|---|---|
| **Vercel Blob (chosen)** | ✅ | ✅ one JSON file/game | Vercel-native, free tier | Simplest match to "a text file"; requires 2 functions |
| GitHub repo as datastore (commit JSON via API) | ✅ (data lives in git) | ✅✅ literally in your repo | GitHub token | Charming, but write latency, rate limits, and can trigger redeploy loops unless data is on a separate branch/repo |
| Vercel KV / Upstash Redis | ✅ | ⚠️ feels like a DB | Upstash free tier | Redis sorted sets are ideal for leaderboards but more moving parts |
| Neon/Postgres | ✅ | ❌ | external DB | Explicitly what we're avoiding |
| Pure client (localStorage) | ❌ shared | — | none | Only per-device; no global competition — rejected |

**Recommendation: Vercel Blob.** GitHub-as-a-file is the runner-up if you'd rather
the scores literally live as a committed file you can `git pull` and eyeball — say
the word and I'll swap the adapter backend; the rest of the plan is identical.

## Architecture

```
Browser (game in iframe at /tether/)
      │  fetch('/api/leaderboard?game=tether')            ← read top N
      │  fetch('/api/leaderboard', {POST, name, score})   ← submit
      ▼
/api/leaderboard  (serverless function, prod)   ──►  Vercel Blob: leaderboard-tether.json
                  (Vite middleware, local dev)   ──►  .data/leaderboard-tether.json  (gitignored)
```

One JSON blob per game. All read-modify-write happens server-side in the function
so clients never touch storage directly.

### Data model
```jsonc
// leaderboard-<game>.json
{
  "game": "tether",
  "board": "normal",              // optional split by difficulty/mode
  "entries": [
    { "name": "AAA", "score": 128.4, "date": "2026-07-06T12:00:00Z" }
  ]
}
```
- `score` is the game's metric (for TETHER: survival `time` in seconds; can also
  carry combined light score). Higher = better; sort desc, keep top **N=20**.
- Server clamps/sanitizes on write; never trusts the client blindly (see below).

### API
- `GET /api/leaderboard?game=tether&board=normal` → `{ entries: [...] }` (top N).
- `POST /api/leaderboard` body `{ game, board, name, score }` →
  server loads blob, inserts, re-sorts, truncates to N, writes back, returns the
  new board + the submitter's rank. Return `qualified: false` if score didn't make
  the cut (client can decide whether to even prompt for a name — see integration).

## Anti-abuse (deliberately light — friends only, no auth)
The user is fine with no authentication. Since a `POST` is forgeable, add cheap
guardrails, not real security:
- **Server-side validation**: `name` → strip to `[A-Z0-9]`, upper-case, 3–8 chars;
  `score` → finite number within a sane per-game max; reject otherwise.
- **Shared secret (optional)**: a build-time env var (e.g. `LEADERBOARD_TOKEN`)
  baked into the game bundle and checked by the function. Stops random internet
  drive-bys; won't stop a determined friend (fine for this).
- **Rate limit (optional)**: naive per-IP throttle in the function.
Skip anything heavier — it's a hobby leaderboard.

## Files to add / change

**New — shared storage + adapter**
- `api/_storage.ts` — adapter with one interface `readBoard(game,board)` /
  `writeBoard(game,board,data)`. Backend selected by env:
  - prod: `@vercel/blob` (`put`/`list`/fetch the JSON).
  - dev/local: `node:fs` reading/writing `.data/leaderboard-*.json`.
- `api/leaderboard.ts` — the GET/POST handler using `_storage` + validation.

**New — local dev analogue**
- Add a Vite plugin in root `vite.config.ts` (`configureServer`) that intercepts
  `/api/leaderboard` and runs the same handler against the local `.data` file, so
  `pnpm dev` (and game iframes) hit a working endpoint without needing `vercel dev`.
  (Alternative: just use `vercel dev` — but the middleware keeps the current
  `pnpm dev` flow intact and dependency-light.)

**New — shared client helper**
- `shared/leaderboard.ts` (or per-game `src/leaderboard.ts` if we avoid a shared
  package): `getLeaderboard(game, board)` and `submitScore(game, board, name, score)`
  thin `fetch` wrappers. Keep it framework-free (matches the games' vanilla TS).

**Changed — TETHER integration** (`tether/src/game.ts`, `tether/src/ui.ts`)
- Metric: survival `this.time` on the current `this.difficulty` (board = difficulty
  label). Consider one board per difficulty so Easy runs don't crowd out Hard.
- Hook point: when `this.mode` transitions to `"ended"` (see
  [game.ts:140-146](tether/src/game.ts#L140-L146)):
  1. `getLeaderboard(...)`; if `time` beats the Nth entry (or board < N), enter a
     lightweight **name-entry state** on the overlay (arcade-style: type A–Z/0–9,
     3 chars, Enter to confirm) instead of the normal "Run Complete" text.
  2. `submitScore(...)`, then render the returned board on the overlay with the new
     entry highlighted.
  3. If not qualified, show the board read-only under the existing summary.
- Keep it non-blocking: network failure → fall back to the current overlay text so
  a dead endpoint never breaks the game.

**Config**
- `.gitignore`: add `.data/`.
- Vercel dashboard: create a Blob store (gives `BLOB_READ_WRITE_TOKEN` env var);
  add optional `LEADERBOARD_TOKEN`.
- `package.json` (root): `@vercel/blob` dependency; ensure `/api` isn't stripped by
  the `dist` assembly step (functions live at repo root `/api`, not in `dist`).

## Build/deploy notes
- The `assemble-dist.mjs` step only copies game builds; `/api` is independent and
  handled by Vercel's function build — verify the Vercel project's Output/Framework
  settings don't exclude `/api`. If a custom Output Directory (`dist`) is set,
  functions in root `/api` still deploy (Vercel treats `/api` specially).
- No `vercel.json` exists today; we likely don't need one, but may add it if we
  want to pin the functions runtime (Node) or rewrites.

## Rollout / sequencing
1. `storage-adapter` + `api-functions` (test the handler in isolation).
2. `local-middleware` so `pnpm dev` serves the endpoint; verify read/write to
   `.data` persists across a dev-server restart.
3. `shared-client`.
4. `tether-integration` — the only game touched in v1; other games opt in later by
   calling the same helpers with their own metric + board.
5. `verify`: deploy, submit from the deployed TETHER, redeploy, confirm the board
   survived (proves Blob persistence, not `/tmp`).

## Cost / limits (Vercel Blob free tier, approx.)
Board is a few KB per game, writes only on a new high score → effectively free.
Reads are one small JSON GET per game-over screen. Well within hobby limits.

## Open questions for the user
- **Metric for TETHER**: survival time only, or time + combined light score? (plan
  assumes time, split per difficulty).
- **Which other games** get boards next (echo, nova, ricochet…)? v1 = TETHER only.
- **GitHub-as-a-file instead of Blob?** Only if you want scores committed into a
  repo you can inspect/pull. Otherwise Blob is simpler.
