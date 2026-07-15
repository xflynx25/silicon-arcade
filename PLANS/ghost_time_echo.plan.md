---
name: GHOST — time-echo racer/duel
overview: "Add a 10th local 2-player game, GHOST, built on one mechanic no other arcade game has: TIME. Each lap is silently recorded into a per-tick ring buffer, then replayed as a translucent 'ghost' of your past self on the next lap, so you race/fight a growing crowd of your own earlier runs. Three modes (Chase co-op, Haunt avoid, Duel combat), a live Echo-Depth knob, leaderboards per mode. Built on the existing self-contained-folder pattern (copied engine primitives + game.ts) with one new primitive: recorder.ts. Determinism is guaranteed by the shared fixed-timestep loop, so pure-playback ghosts can never desync."
todos:
  - id: scaffold
    content: "Copy salvo/ → ghost/ (closest: arena + rounds). Strip salvo game.ts/config.ts; keep copied engine primitives verbatim. Register the folder everywhere: pnpm-workspace.yaml, root dev:ghost + build games array (scripts/assemble-dist.mjs), arcade/main.ts tile. Add @arcade/leaderboard dep. README + CHANGELOG stubs."
    status: completed
  - id: input
    content: "Extend input.ts (ghost copy only) with a `secondary` verb per player (Space / Enter) and a global Echo-Depth adjust on `[`/`]`, without breaking the existing Enter=start / R=restart globals."
    status: completed
  - id: recorder
    content: "NEW primitive recorder.ts: a fixed-tick ring-buffer recorder sampling {x,y,angle,flags} into a flat Float32Array, plus a Ghost entity that replays one frozen recording deterministically (pure playback, no physics). Freeze-at-lap-end + fresh-recording lifecycle, Echo-Depth cap on live ghosts."
    status: completed
  - id: modes
    content: "modes.ts — per-mode config + hooks. Build the three on top of the recorder: CHASE (co-op relay to a goal), HAUNT (collect sparks, avoid every ghost), DUEL (strike duel where ghosts re-strike on their original ticks). Wire into game.ts state machine (title picker 1/2/3)."
    status: completed
  - id: juice
    content: "Ghost visuals (desaturated/translucent, oldest=faintest, motion trail, per-ghost hue), rewind-shimmer + reverse-whoosh on lap reset, near-miss screen ripple, mode SFX. HUD (mode, lap #, ghost count, echo depth), title + hold-H How-to-Play."
    status: completed
  - id: verify
    content: "Determinism check (a recorded ghost retraces its path exactly), leaderboard boards per mode (ghost/chase laps, ghost/haunt score), typecheck + full `pnpm build`, CHANGELOG + README. Manual playtest per your no-browser-verify rule."
    status: completed
isProject: true
---

# GHOST — the time game

Graduated from `PLANS/PREPLANS/ghost_time_echo.preplan.md`. This is the locked
build plan for the arcade's 10th game and the first to touch **time**: recording a
lap and replaying it as ghosts of your past selves. Every other game is stateless
in time (the world only reacts to *now*); GHOST's single new idea is a per-tick
position buffer that plays back deterministically.

## Why the hard part is already solved

The load-bearing requirement is **determinism** — a recorded run must retrace its
exact path on replay. The shared engine already guarantees it: `loop.ts` is a
**fixed-timestep accumulator** (`fixedStep = 1/120`) that calls `update(dt)` a
whole number of times per frame with a constant `dt`, decoupled from monitor
refresh. Because a `Ghost` sets its transform *directly* from a recorded frame
(pure playback, no physics re-simulation), it literally cannot desync from what the
player did. That's why this is the one that ships: the novel system is one small
buffer on top of infrastructure that already exists.

## Repo shape (mirror salvo, self-contained folder)

Each game is its own folder with **copied** engine primitives (the arcade
deliberately duplicates `vec/loop/input/particles/audio/ui/main` per game rather
than sharing them, so a game never breaks when another changes). The only shared
package is `@arcade/leaderboard`.

```
ghost/
  index.html            # copy of salvo's; retitle GHOST, retheme colors
  package.json          # name "ghost"; add "@arcade/leaderboard": "workspace:*"
  tsconfig.json         # copy verbatim
  vite.config.ts        # copy verbatim
  src/
    main.ts             # copy verbatim (drives the Game interface — see below)
    loop.ts             # copy VERBATIM — do not touch; determinism source
    vec.ts              # copy verbatim
    particles.ts        # copy verbatim
    audio.ts            # copy verbatim (WebAudio synth)
    ui.ts               # copy verbatim (Hud: left/center/right + overlay)
    input.ts            # copy + EXTEND (secondary verb + echo-depth knob)
    recorder.ts         # NEW — ring-buffer recorder + Ghost playback entity
    modes.ts            # NEW — per-mode config + hooks (chase/haunt/duel)
    game.ts             # NEW — state machine wiring recorder into each mode
```

`main.ts` is copied unchanged and expects the exact `Game` interface salvo
exports, so `game.ts` must satisfy it:

```ts
export type Game = {
  phase: GamePhase;                       // "title" | "playing" | ...
  resize: (w, h) => void;
  startMatch: () => void;
  restartMatch: () => void;
  update: (dt, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem) => void;
  render: (ctx, w, h) => void;
  applyShake: (ctx) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};
```

`main.ts` already: calls `startMatch()` when `consumeGlobal().startPressed && phase==="title"`,
calls `restartMatch()` on `R`, reads `readPlayerOne()/readPlayerTwo()`, pushes
`getHud()`/`getOverlay(input.isHeld("KeyH"))` to the DOM Hud each tick, and wraps
render in `applyShake`. GHOST inherits all of that for free.

### Registration (four touch-points — easy to miss)

1. `pnpm-workspace.yaml` — add `"ghost"` to `packages`.
2. Root `package.json` scripts — add `"dev:ghost": "pnpm --filter ghost dev"`.
3. `scripts/assemble-dist.mjs` — add `"ghost"` to the `games` array so `pnpm build`
   emits `dist/ghost/`.
4. `arcade/main.ts` — add a registry tile `{ id:"ghost", name:"GHOST", tag:"Time duel",
   summary:"…", accent:"#b48cff" (spectral violet), glyph:"…" }` so it appears on the
   arcade launcher grid.

After files are written: **I will not run `pnpm i`** (your rule) — you run
`pnpm i`, then `pnpm dev:ghost`.

## Input extension (ghost's `input.ts` only)

The current `PlayerInput` is `{ x, y, primary }`. GHOST needs a **secondary** verb
(brake/parry) and a global **Echo-Depth** knob, per the arcade's live-knob
convention (cf. NOVA gravity, POLARITY field strength). Changes, contained to the
ghost copy so no other game is affected:

- `PlayerInput` → `{ x, y, primary, secondary }`.
  - P1 `secondary` = held `Space`; P2 `secondary` = held `Enter`.
  - Safe against the start binding: `main.ts` only consumes `startPressed`
    (Enter/NumpadEnter) while `phase === "title"`, and during `"playing"` a held
    Enter simply reads as P2 secondary. No conflict.
- New global on `consumeGlobal()` (or a small `readEchoDepth()`): edge-triggered
  `echoDepthDown` on `BracketLeft` (`[`) and `echoDepthUp` on `BracketRight` (`]`),
  using the existing `consumePress` pattern. Add `[`/`]` to `BLOCKED_KEYS`? No —
  they don't scroll the page; leave `BLOCKED_KEYS` as is.
- `game.update(...)` already receives the `input` manager, so it can call these
  directly; only the tiny type/method additions are needed.

## The core primitive — `recorder.ts`

This is the entire novel system. Everything else is dressing.

**Frame layout.** Fixed stride flat buffer, no per-frame objects:
```
STRIDE = 4                      // x, y, angle, flags
frame i occupies buf[i*4 .. i*4+3]
flags = bit0 primary | bit1 secondary   // packed button state as a float
```

**Sizing.** Lap = a fixed timer (start at **12 s**; see open questions). At
`1/120` s/tick that's `120*12 = 1440` frames × 4 = 5760 floats ≈ **23 KB** per
ghost. To halve memory and it-still-reads-fine, sample every **2nd** tick
(`SAMPLE_EVERY = 2`, ~60 Hz) and have the Ghost hold each sampled frame for 2
ticks — cheap and imperceptible. Buffers are pre-allocated `Float32Array` of the
known max length; no growth/GC during play.

**Recorder** (one per live player):
```ts
class Recorder {
  private buf: Float32Array;     // pre-sized to maxFrames*STRIDE
  private len = 0;               // frames written
  private tick = 0;              // for SAMPLE_EVERY gating
  sample(x, y, angle, flags): void   // append if this.tick % SAMPLE_EVERY === 0 and len<cap
  freeze(): Recording               // return a frozen view (buf + len) and reset for next lap
  reset(): void
}
type Recording = { buf: Float32Array; len: number; hue: number; lap: number };
```

**Ghost** (one per frozen recording; pure playback):
```ts
class Ghost {
  constructor(private rec: Recording) {}
  playhead = 0;                  // frame index
  x = 0; y = 0; angle = 0; flags = 0;
  advance(): void {              // called every tick; reads next sampled frame, sets transform
    const f = Math.min(this.playhead >> SAMPLE_SHIFT, this.rec.len - 1);
    // read buf[f*4..]; set x,y,angle,flags DIRECTLY — no physics
    this.playhead++;
  }
  get finished(): boolean        // playhead past recording end (loops or idles per mode)
}
```

**Lifecycle.** On lap end: `const rec = recorder.freeze()` → `ghosts.push(new Ghost(rec))`
→ `recorder.reset()` and a fresh recording begins. Enforce **Echo Depth** (1–5,
default 3) by keeping only the newest N ghosts live (`ghosts.splice(0, ghosts.length-depth)`);
older recordings are dropped so buffers stay bounded on long runs. Each ghost gets
a `hue` = `(lap * 47) % 360` so players can read "that's my lap-2 self."

Determinism note: the recorder samples the **already-simulated** live entity's
transform each tick and the Ghost writes it back verbatim — so replay is exact by
construction. No RNG may drive live-entity motion off the recorded stream; any
mode randomness (spark spawns) must not perturb ghost playback.

## Modes — `modes.ts` + `game.ts`

Title-screen picker `1`/`2`/`3` (the arcade convention `main.ts`/Hud already
support via `consumePress`). `modes.ts` holds per-mode config + a small set of
hooks the shared `game.ts` state machine calls; the recorder/ghost machinery is
identical across modes — only the objective/collision rules differ.

- **1 · CHASE (co-op relay).** A single glowing orb must be carried to a goal;
  it's heavier than one runner can move quickly. Reach the goal → lap resets and
  the just-finished run becomes a ghost that *keeps carrying/blocking*, so two live
  players + their stacking ghosts form a relay chain across an escalating course.
  **Shared score = laps completed before a match timer.** Leaderboard metric = laps.
- **2 · HAUNT (competitive avoidance).** Free-for-all: collect drifting sparks for
  points; touching **any** ghost (yours or rival's) drops your spark streak and
  briefly stuns. Every lap adds ghosts, so late laps become a minefield of your own
  habits. Higher score after N laps wins. Leaderboard metric = score.
- **3 · DUEL (fight your echoes).** Combat arena, one "strike" (primary) + a short
  parry (secondary). Landing a strike on the rival scores; their accumulated ghosts
  also strike on the **exact ticks** their originals did (flags bit0 from the
  recording). Reading/dodging replayed attacks is the skill. **Best of 5.** Versus
  outcome → **no leaderboard board** (or a local-only round tally).

`game.ts` phases (extend salvo's): `"title" | "playing" | "lapEnd" | "matchEnd"`.
`lapEnd` is a brief pause that fires the freeze + rewind-shimmer, then respawns
live players and resumes. `restartMatch()` clears ghosts, recorder, score, echo
depth back to default.

## Controls

- P1 `WASD` move · `LShift` primary · `Space` secondary.
- P2 arrows move · `RShift`/`/` primary · `Enter` secondary.
- Primary is the mode verb: **grab** (Chase) / **dash** (Haunt) / **strike** (Duel).
  Secondary is a short **brake/parry**.
- Global `[` / `]` = **Echo Depth** (1–5 live ghosts). Fewer = calmer, more = chaos.
- `Enter` start (title), `R` restart, hold `H` for How-to-Play (all inherited).

## Feel / juice

- Ghosts render **desaturated + translucent**, oldest = faintest, with a short
  motion trail so direction reads; subtle per-ghost hue.
- **Rewind shimmer** on each lap reset: scanline sweep + reverse-whoosh SFX
  (`audio.ts` synth) as new ghosts spawn.
- **Near-miss ripple**: screen ripple when a live player passes through the exact
  cell a ghost occupied a moment before.
- Duel: a **telegraph flash** a few ticks before a ghost strike (guarding against
  the "unreadable" risk flagged in the preplan).
- Reuse `applyShake` for hits/goals; pooled `particles.ts` for sparks/bursts.

## Leaderboards

`@arcade/leaderboard` (fail-soft; hides itself if the endpoint/Blob store is
absent — dev is served by the Vite middleware, prod by `/api/leaderboard`). One
board **per mode**, following the ricochet wiring pattern
(`getLeaderboard`/`qualifies`/`submitScore` + a `NameEntry` on the game-over
overlay, 3–8 chars, only prompted on a qualifying run):

```ts
const LEADERBOARD_GAME = "ghost";
// board = "chase" (metric laps) | "haunt" (metric score). Duel: no board.
```

Only render the board on `matchEnd`. Score submission and name entry must not run
during `"playing"` (guard on phase), matching ricochet.

## Open questions — resolved for the build

- **Lap length:** fixed **12 s** timer (uniform ghost lengths → trivial buffer
  sizing). Revisit only if a mode feels bad.
- **Memory ceiling:** Echo Depth caps *live* ghosts at 5; frozen recordings beyond
  the cap are dropped. Bounded regardless of match length.
- **Duel fairness:** ship with the pre-strike telegraph flash; if still
  unreadable in playtest, widen the telegraph window rather than randomize (which
  would break determinism/readability).

## Verify (before calling it done)

1. **Determinism check** — record a lap, replay it, assert the Ghost's per-tick
   `(x,y,angle)` equals the originally-recorded frames (they must, by
   construction; add a tiny dev assertion to catch accidental physics leakage into
   ghost transforms).
2. Leaderboard boards resolve for `ghost/chase` and `ghost/haunt` in dev (Vite
   middleware) and hide cleanly when disabled.
3. `pnpm build` — `pnpm -r build` (per-game `tsc --noEmit && vite build`), root
   `tsc --noEmit`, `vite build`, `assemble-dist.mjs` emits `dist/ghost/`.
4. Arcade launcher shows the GHOST tile and boots it in the iframe.
5. CHANGELOG entry + README section (controls + `pnpm dev:ghost`).
6. **Manual playtest by you** — per your standing rule I will not launch a browser
   / dev server to visually verify; I'll hand you the exact run commands.

## After build — what you run

`pnpm i` (installs the new `@arcade/leaderboard` workspace link), then
`pnpm dev:ghost` to play GHOST standalone, or `pnpm dev` (arcade) → GHOST tile.
