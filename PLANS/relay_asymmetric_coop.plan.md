---
name: RELAY — asymmetric co-op (the two keyboards see different things)
overview: "Build RELAY, a 10th arcade game on the same Vite + TypeScript + Canvas + WebAudio stack, in a new self-contained relay/ workspace folder. Unlike the 9 symmetric games, RELAY splits one keyboard into two complementary roles with different information: PILOT (P1) drives an avatar but sees only a fog bubble; NAVIGATOR (P2) sees the whole map/manual but can't move — they win by talking across the couch and by a small in-game pinging channel. Two modes (ESCORT, DEFUSE), one leaderboard board each, wired into the arcade launcher and dist build."
todos:
  - id: scaffold
    content: "Create relay/ workspace folder (index.html, package.json, tsconfig.json, vite.config.ts with base:./ + leaderboardDevPlugin, src/) mirroring cipher's setup; add to pnpm-workspace.yaml, root dev:relay script, and scripts/assemble-dist.mjs games list"
    status: pending
  - id: engine
    content: "Port the shared engine primitives into relay/src (vec, loop fixed-timestep, input with P1/P2 split, particles pool, audio synth, ui overlay); no runtime deps, no per-frame shadowBlur (follow the perf lessons in CHANGELOG)"
    status: pending
  - id: fog
    content: "Core new system src/fog.ts — a cached radial-gradient alpha mask composited with destination-in so only geometry inside the Pilot's bubble renders on the Pilot layer; Navigator layer is fog-free. Single reusable offscreen mask, no per-frame blur. [ / ] adjust fog radius."
    status: pending
  - id: comms
    content: "src/comms.ts — Navigator signalling with a bandwidth cap: a few active pings max (go-here waypoint / danger arrow / wait), placed with the P2 cursor, visible to the Pilot through the fog; pings pulse and fade. Everything else is verbal."
    status: pending
  - id: modes
    content: "src/modes.ts + game.ts — ESCORT (scrolling hazard maze, blind Pilot to the exit before the timer; score = maze depth) and DEFUSE (symbol panel on Pilot side, symbol→sequence manual on Navigator side, enter under a shrinking timer; score = panels defused). Title picker 1/2, Enter start, R restart, H help; How-to-Play makes the role split explicit and colour-codes each zone."
    status: pending
  - id: juice
    content: "Fog-edge shimmer, ping VFX/SFX, shared rising-tension pad keyed to nearest-unseen-hazard distance (the one shared info channel), 'locked' chime on reaching a waypoint, split HUD, title screen. Optional handoff/role-swap as an off-by-default toggle."
    status: pending
  - id: leaderboard
    content: "Wire @arcade/leaderboard: LEADERBOARD_GAME='relay', boards 'escort' (depth) and 'defuse' (panels). End-of-run overlay shows the board and prompts for initials on a qualifying run. Register relay in arcade/main.ts GAMES + LEADERBOARD_GAMES with per-board tabs."
    status: pending
  - id: verify
    content: "Playtest the comms loop is fun not frustrating (prototype ESCORT first with programmer-art fog before polish). Add relay to README game table + a RELAY specifics/controls section, add a CHANGELOG entry, smoke-test dev:relay renders and both roles respond to keys, and confirm it boots inside the arcade iframe."
    status: pending
isProject: false
---

# RELAY — you can't both see and act

The 10th arcade game. All 9 existing games (TETHER, POLARITY, RICOCHET, ECHO,
VORTEX, NOVA, LATTICE, SALVO, CIPHER) are **symmetric**: P1 and P2 have identical
abilities and identical information, mirrored to left/right hands. RELAY breaks
that. The two players hold **complementary halves** of one task and *must
communicate out loud* to win. The novelty is not a physics trick — it's the
**information structure**: hidden info split across one shared keyboard and one
shared screen. This is "Keep Talking and Nobody Explodes" energy on a single
couch display.

- **PILOT** (P1, left hand) controls the avatar but sees only a small **fog
  bubble** around it — hazards, walls, and the exit outside the bubble are
  invisible to the moving piece.
- **NAVIGATOR** (P2, right hand) sees the **whole map / the manual**, but has
  *no movement control* — they can only place a couple of guidance pings and
  talk.

Because it's couch co-op on one display, the "hidden" info is hidden by
*rendering* (fog on one layer, a code panel only one side is told to read)
rather than by separate screens — players just don't process the half that
isn't theirs. A short How-to-Play makes the split explicit and colour-codes each
player's zone (Pilot = warm/left accent, Navigator = cool/right accent).

## Where it fits in the repo (integration points — verified against the codebase)

This is a new **pnpm workspace member**, self-contained like every other game.
The repo runs one Vite server at the root that serves the launcher at `/` and
each game at `/<game>/`; the launcher boots a game inside an iframe.

Concretely, to add RELAY you touch:

1. **`relay/` folder** — new, mirroring `cipher/`:
   - `index.html` (canvas fills `#app`, dark bg, relative script src so it runs
     both standalone and inside the arcade iframe).
   - `package.json` — name `relay`, `dev`/`build` scripts, dep
     `@arcade/leaderboard: workspace:*`, devDeps `typescript` + `vite`.
   - `tsconfig.json` — copy cipher's verbatim (ES2022, Bundler, strict, noEmit,
     `types: ["vite/client"]`).
   - `vite.config.ts` — copy cipher's verbatim: `base: "./"`,
     `plugins: [leaderboardDevPlugin()]` (imported from `../scripts/...`),
     `server.open: false`.
2. **`pnpm-workspace.yaml`** — add `- "relay"`.
3. **Root `package.json`** — add `"dev:relay": "pnpm --filter relay dev"`.
4. **`scripts/assemble-dist.mjs`** — add `"relay"` to the `games` array so it's
   copied into `dist/` on build.
5. **`arcade/main.ts`** — add a `Game` entry to `GAMES` (id `relay`, name,
   tag `Asymmetric co-op`, summary, accent, SVG glyph) and a `LeaderboardGame`
   entry to `LEADERBOARD_GAMES` with two boards (see Leaderboard below).
6. **`README.md`** — a row in the game table + a "RELAY specifics" controls
   section; **`CHANGELOG.md`** — a dated entry.

> Do NOT run `pnpm i` myself (per repo rule). After the files exist, you run
> `pnpm i`, then `pnpm dev` (arcade) or `pnpm dev:relay` (standalone).

## Folder layout

The two most recent games diverge in style: TETHER split the engine across
`vec/loop/input/particles/audio/ui/game.ts`, while CIPHER collapsed everything
into a single `src/main.ts`. RELAY has two genuinely new subsystems (fog +
comms) that deserve their own files, so it follows the **multi-file** layout:

```
relay/
  index.html  package.json  tsconfig.json  vite.config.ts
  src/main.ts        # boot: canvas, DPR scale, loop start, leaderboard wiring
  src/vec.ts         # 2D vector math (port)
  src/loop.ts        # fixed-timestep accumulator over rAF (port)
  src/input.ts       # held-key set, P1 (WASD/LShift/Space) vs P2 (arrows/RShift/Enter), preventDefault
  src/particles.ts   # pooled particles (port)
  src/audio.ts       # WebAudio synth SFX + the shared tension pad
  src/ui.ts          # title, How-to-Play, split HUD, run-complete overlay
  src/fog.ts         # NEW: cached radial mask + per-role render gating
  src/comms.ts       # NEW: ping/waypoint signalling with a bandwidth cap
  src/modes.ts       # escort / defuse config + copy
  src/game.ts        # state machine + entities for both modes
```

Ports come from an existing game (tether/salvo are good sources). Keep them
self-contained per folder — that's the established pattern; do not try to share
engine code across games (only `@arcade/leaderboard` is shared).

## The core system: split visibility + limited signalling

### Fog (`src/fog.ts`) — the one genuinely new render technique

- Build **one** offscreen canvas holding a soft radial-gradient alpha mask
  (opaque at center → transparent at `fogRadius`). Cache it; only rebuild when
  `fogRadius` changes (the `[` / `]` knob), not per frame.
- Render order per frame:
  1. Draw the **Navigator layer** (full world: walls, hazards, exit, the
     manual) — fog-free, this is what P2 reads.
  2. On a separate scratch layer draw the **Pilot's world geometry**, then
     composite the cached mask with `globalCompositeOperation = "destination-in"`
     centered on the Pilot, so only what's inside the bubble survives. Blit that
     onto the main canvas over the Pilot's region.
  3. Hazards straddling the fog edge can render as **vague silhouettes** (lower
     alpha) for a beat of warning.
- **No per-frame `shadowBlur`** and no per-frame blur filters — the CHANGELOG
  records repeated perf regressions from exactly that across POLARITY / ECHO /
  RICOCHET / SALVO. The cached-mask + `destination-in` approach is cheap.
- On a single shared screen the "two views" are conceptual: it's one canvas,
  but the Pilot's actionable geometry is fog-gated while the Navigator's isn't.

### Comms (`src/comms.ts`) — guided talking, not silent solo play

- The Navigator moves a **cursor** with the arrow keys and drops a **ping** with
  `RShift`; `Enter` cycles ping type: **go-here waypoint** / **danger arrow** /
  **wait**.
- **Bandwidth cap:** only a couple of pings active at once. Placing a new one
  past the cap retires the oldest. This forces the Navigator to choose *what* to
  communicate — everything else must be spoken aloud. This budget IS the game;
  keep it small.
- Pings are visible to the Pilot **through the fog** (they render on the Pilot
  layer, above the mask), pulse, and fade after a few seconds.

## Modes (`src/modes.ts`, title picker `1`/`2`)

- **1 · ESCORT** — scroll a hazard maze (moving walls, timed gates, drifting
  mines) past the blind Pilot to the exit before a timer. Navigator sees the
  layout and calls/pings the route. **Score = maze depth reached / mazes
  cleared.** Prototype this mode first (see Open questions).
- **2 · DEFUSE** — a "panel" of symbols appears on the **Pilot's** side; the
  **Navigator's** side shows the **manual** mapping symbols → the correct input
  sequence. Pilot enters the sequence (`LShift` to commit inputs) under a
  shrinking timer while the Navigator reads instructions aloud. Wrong entry =
  penalty; waves escalate. **Score = panels defused.** This is deliberately the
  arcade's lowest-twitch, most cerebral game.

## Controls (shared keyboard — matches arcade convention)

- **Pilot (P1):** `WASD` move, `LShift` interact / commit input, `Space`
  brake/hold.
- **Navigator (P2):** arrow keys aim a cursor, `RShift` drop a ping, `Enter`
  cycle ping type. No avatar control.
- **Global:** `1`/`2` pick mode + `Enter` start, `R` restart, hold `H` for
  How-to-Play, `[` / `]` adjust **Fog Radius** (accessibility/difficulty knob).
- **Optional handoff:** an off-by-default toggle that swaps roles on a timer —
  hence "RELAY". Ship it as a toggle, not the default; it may dilute the
  "learn your role deeply" tension.

## Feel / juice

- Fog edge shimmers subtly. Unseen hazards emit a faint audio cue that rises
  only as the Pilot nears them, so the Navigator's warnings and the sound
  reinforce each other.
- Ping arrows pulse and fade; a satisfying **"locked" chime** when the Pilot
  reaches a waypoint.
- A **rising tension pad** keyed to nearest-unseen-hazard distance, played on the
  shared speakers so **both** players hear it — the single shared information
  channel that both roles get.

## Leaderboard (opt-in Blob pattern, already in the repo)

Import from the shared workspace package, exactly like CIPHER:

```ts
import { getLeaderboard, submitScore, qualifies, type LeaderboardEntry } from "@arcade/leaderboard";
const LEADERBOARD_GAME = "relay";
// board id chosen by active mode:
const LEADERBOARD_BOARD = mode === "escort" ? "escort" : "defuse";
```

- On run-complete: `getLeaderboard(game, board)`; if `qualifies(entries, score)`,
  prompt arcade-style initials (A–Z / 0–9) and `submitScore`. Everything fails
  soft — a dead endpoint hides the board, never breaks the game (that's the
  contract in `shared/src/index.ts`).
- Register in `arcade/main.ts` → `LEADERBOARD_GAMES`:
  ```ts
  { id: "relay", name: "RELAY", accent: "<accent>",
    boards: [{ id: "escort", label: "Escort" }, { id: "defuse", label: "Defuse" }],
    formatScore: (score, boardId) =>
      boardId === "escort" ? `Depth ${Math.round(score)}` : `${Math.round(score)} defused` }
  ```
- No new API work: `/api/leaderboard` + the dev plugin already store one JSON
  blob per `game+board`, so `relay/escort` and `relay/defuse` just work.

## Build / dist

`pnpm build` runs `pnpm -r build` (each game's `tsc --noEmit && vite build`),
then `tsc --noEmit`, then `vite build`, then `node scripts/assemble-dist.mjs`.
RELAY is picked up automatically once it's in `pnpm-workspace.yaml` and the
`games` array in `assemble-dist.mjs`. Verify `dist/relay/` appears after a build.

## Open questions / biggest risk

- **Is it fun or just frustrating?** The fun lives entirely in the comms loop.
  Prototype **ESCORT** first with programmer-art fog and a tiny ping budget,
  playtest the couch-talking loop, and only then polish. If the talking isn't
  fun at greybox, more art won't save it.
- **Fog cost:** confirmed cheap via the cached radial mask + `destination-in`;
  do not reach for `shadowBlur` (see CHANGELOG perf history).
- **Handoff/role-swap:** ship as an optional toggle, default off.

## After build — what to run

`pnpm i`, then `pnpm dev` and open the printed URL → RELAY tile in the arcade,
or `pnpm dev:relay` for the standalone game. Per the user's rule, I write the
files; the human runs installs and does the manual playtest.
