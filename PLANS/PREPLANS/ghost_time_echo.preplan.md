---
name: GHOST — time-echo racer/duel
overview: "A local 2-player game built on one brand-new mechanic for this arcade: TIME. Each lap you play is silently recorded, then replays as a translucent 'ghost' of your past self on the next lap. You end up racing (or fighting) a growing crowd of your own earlier runs. No other game in the arcade records or replays time — this is the whole hook."
status: brainstorm — ACTIVELY BUILT (first of the 3 to graduate)
isProject: true
todos:
  - id: scaffold
    content: Copy an existing game folder (salvo is closest — arena + rounds) into ghost/, strip its game.ts, wire dev:ghost script + workspace + README stub
    status: in_progress
  - id: recorder
    content: "Core new primitive — a ring-buffer recorder: sample {x,y,angle,action-flags} per fixed tick into a Float32Array; a Ghost entity replays one recording deterministically alongside live input"
    status: pending
  - id: modes
    content: "Build the three modes on top of the recorder: Chase (co-op relay), Haunt (competitive avoid-your-ghosts), Duel (fight past selves)"
    status: pending
  - id: juice
    content: Ghost visuals (fading trails, desaturated echoes, spawn 'rewind' shimmer), collision/overlap SFX, HUD (lap #, ghost count), title + How-to-Play
    status: pending
  - id: verify
    content: Determinism check (a recorded ghost must retrace its path exactly under fixed timestep), leaderboard board, changelog + README
    status: pending
---

# GHOST — the time game

## Why this is new (vs. the existing 9)

Every current game is **stateless in time**: the world only ever reacts to *right
now*. GHOST's single new idea is **recording and replaying the past**. You play a
short lap; the game captures your exact motion; on the next lap a translucent copy
of that run — a **ghost** — moves through the arena alongside you. Ghosts
accumulate, so by lap 4 you're weaving through three earlier versions of yourself.

This is one clean, cheap-to-implement mechanic (a per-tick position buffer) that
produces a genuinely different *feel* from anything in the arcade: you're
competing/cooperating against your **own decisions**, not physics.

Determinism is the load-bearing requirement, and the arcade already has it: the
fixed-timestep loop (`loop.ts`) means a recorded input/position stream replays
identically. That's why this is the actively-built one — the hard part is already
solved by the shared engine.

## The core primitive: the recorder

- Every fixed tick, append a frame to a per-player ring buffer:
  `{ x, y, angle, flags }` where `flags` packs button states (fired / dashed).
  Store as a flat `Float32Array` (≈ 4 floats × 60 Hz × ~15 s = tiny).
- A `Ghost` entity = one frozen recording + a playhead. On each tick it reads the
  next frame and sets its transform directly (no physics sim — pure playback), so
  it can never desync from what the player actually did.
- At lap end, the live player's buffer is frozen into a new `Ghost` and a fresh
  recording begins. Ghost count grows each lap.

That's the entire novel system. Everything else is dressing on top.

## Modes (title picker `1`/`2`/`3`)

- **1 · CHASE (co-op relay).** A single glowing orb must be carried to a goal, but
  it's heavier than one runner can move quickly. Reach the goal, the lap resets,
  and *your own ghost from the previous lap keeps carrying/blocking* — so the two
  live players plus their stacking ghosts form a relay chain across an escalating
  course. Shared score = laps completed before the timer. Cooperative *with your
  past selves*.
- **2 · HAUNT (competitive avoidance).** Free-for-all: collect drifting sparks for
  points, but touching **any** ghost (yours or your rival's) costs you the spark
  streak and briefly stuns you. Since every lap adds ghosts, the arena fills with
  hazards *you personally created* — late laps are a minefield of your own habits.
  Higher score after N laps wins.
- **3 · DUEL (fight your echoes).** Combat arena. You have one "strike." Landing it
  on the rival scores — but their accumulated ghosts also strike on the exact ticks
  their originals did. Reading and dodging the rival's *replayed* attacks (which are
  perfectly predictable if you paid attention) is the skill. Best of 5.

## Controls

- Standard arcade move set. `WASD` / arrows to move; primary (`LShift`/`RShift`) is
  the mode verb (grab in Chase, dash in Haunt, strike in Duel); secondary
  (`Space`/`Enter`) a short brake/parry.
- New global affordance: **`[` / `]` adjust Echo Depth** (how many past ghosts stay
  active, 1–5) — the arcade's live-knob convention (cf. NOVA gravity, POLARITY
  field strength). Fewer ghosts = calmer; more = chaos.

## Feel / juice

- Ghosts render desaturated and translucent, oldest = faintest, with a short motion
  trail so their *direction* reads. A "rewind shimmer" (scanline sweep + reverse
  whoosh SFX) plays on each lap reset when new ghosts spawn.
- Subtle per-ghost hue so players can tell "that's my lap-2 self."
- Screen ripple when you pass *through* the exact spot a ghost occupied a moment
  before ("near-miss with the past").

## Leaderboard

Metric = **laps survived/completed** (Chase) or **score** (Haunt). One board per
mode. Standard opt-in Blob pattern; only show on a qualifying run.

## Folder layout (mirrors salvo)

```
ghost/
  index.html  package.json  tsconfig.json  vite.config.ts
  src/{main,input,loop,vec,particles,audio,ui}.ts   # copied engine primitives
  src/recorder.ts   # NEW: ring-buffer recorder + Ghost playback entity
  src/modes.ts      # per-mode copy + config (chase/haunt/duel)
  src/game.ts       # state machine wiring recorder into each mode
```

## Open questions to resolve during build

- Lap length: fixed timer (e.g. 12 s) vs. objective-triggered? Start with a timer;
  it makes ghost lengths uniform and the buffer sizing trivial.
- Memory ceiling: cap total ghosts (Echo Depth) so buffers stay bounded on long runs.
- Does Duel's "ghost strikes on the same tick" feel fair or unreadable? Prototype
  first; may need a telegraph flash a few ticks before a ghost attack.
