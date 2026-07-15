---
name: RELAY — asymmetric co-op (the two keyboards see different things)
overview: "A local 2-player co-op game where the two players have DIFFERENT roles and DIFFERENT information — one drives blind, the other can see but can't drive. Success comes from talking to each other across the couch. Every existing arcade game is symmetric (both players do the same thing); RELAY's new axis is information asymmetry between the two halves of one keyboard."
status: brainstorm
isProject: false
todos:
  - id: scaffold
    content: New relay/ folder from the shared template; dev:relay script + workspace + README stub
    status: pending
  - id: fog
    content: "Core new system — split visibility: render the same world twice conceptually, gating what each player's HUD/overlay reveals (Pilot sees a fog bubble; Navigator sees the map but not live hazards)"
    status: pending
  - id: comms
    content: "Limited in-game signalling so it's not pure yelling — Navigator drops ping markers / directional arrows the Pilot can see; small bandwidth budget"
    status: pending
  - id: modes
    content: Build Escort (guide the blind pilot through a hazard maze) and Defuse (Navigator reads a manual, Pilot acts under time pressure)
    status: pending
  - id: juice
    content: Fog rendering, ping VFX/SFX, tension audio that rises near unseen hazards, HUD split, title + How-to-Play that explains the asymmetry clearly
    status: pending
  - id: verify
    content: Playtest the comms loop is fun not frustrating; leaderboard board; changelog + README
    status: pending
---

# RELAY — you can't both see and act

## Why this is new (vs. the existing 9)

All 9 current games are **symmetric**: P1 and P2 have identical abilities and
identical information, mirrored to left/right hands. RELAY breaks that. The two
players hold **complementary halves** of the same task and *must communicate out
loud* to win. The novelty isn't a physics trick — it's the **social/information
structure**: hidden info split across one keyboard.

This is the classic "Keep Talking and Nobody Explodes" / "co-op VR guide" energy,
adapted to one shared screen split into two information zones. Nothing in the
arcade explores talking-as-the-mechanic.

The screen is **one canvas**, but each player's readable information is gated:
- **PILOT** (P1, left hand) controls the avatar but sees only a small **fog bubble**
  around it — hazards outside the bubble are invisible to the moving piece.
- **NAVIGATOR** (P2, right hand) sees the **whole map / the manual**, but has *no
  movement control* — they can only place guidance markers and talk.

Because it's couch co-op on one display, the "hidden" info is hidden by *rendering*
(fog, a code panel only one side is told to read) rather than by separate screens —
players just don't process the half that isn't theirs. A short How-to-Play makes the
role split explicit, and colour-codes each player's zone.

## The core system: split visibility + limited signalling

- **Fog of war** around the Pilot: a soft radial mask; hazards, walls, and the exit
  render only inside it (or as vague silhouettes at the edge). The Navigator's view
  is fog-free.
- **Signalling budget** so it's guided talking, not silent solo play: the Navigator
  presses arrows to drop **directional ping arrows** or a **waypoint dot** the Pilot
  can see through the fog, but only a couple active at once (bandwidth limit) — they
  must choose *what* to communicate. Everything else is verbal.
- Optional twist: periodically the roles **swap** (a "handoff") so both players learn
  both jobs — hence the name RELAY.

## Modes (title picker `1`/`2`)

- **1 · ESCORT.** Navigate the blind Pilot through a scrolling hazard maze (moving
  walls, timed gates, drifting mines) to the exit before the timer. Navigator sees
  the layout and calls/pings the route. Score = depth reached / mazes cleared.
- **2 · DEFUSE.** A "panel" appears on the Pilot's side with symbols; the Navigator's
  side shows the **manual** mapping symbols → the correct input sequence. Pilot must
  enter the sequence under a shrinking timer while the Navigator reads instructions
  aloud. Wrong entry = penalty. Wave-escalating. (This is the arcade's most
  cerebral, lowest-twitch game — deliberately.)

## Controls

- **Pilot (P1):** `WASD` move, `LShift` interact/enter-input, `Space` brake/hold.
- **Navigator (P2):** arrows aim a cursor, `RShift` drop a ping/waypoint, `Enter`
  cycle ping type (go-here / danger / wait). No avatar control.
- Global: `[` / `]` adjust **Fog Radius** (accessibility/difficulty knob), `H` help,
  `R` restart. On handoff-enabled runs, roles swap on a timer.

## Feel / juice

- The fog edge shimmers; unseen hazards emit a faint audio cue that only rises as the
  Pilot nears them — so the Navigator's warnings and the sound reinforce each other.
- Ping arrows pulse and fade; a satisfying "locked" chime when Pilot reaches a waypoint.
- Rising tension pad keyed to nearest-unseen-hazard distance (shared, both players
  hear it — the one shared information channel).

## Leaderboard

Metric = **maze depth** (Escort) or **panels defused** (Defuse). One board per mode.
Standard opt-in Blob pattern.

## Folder layout

```
relay/
  index.html  package.json  tsconfig.json  vite.config.ts
  src/{main,input,loop,vec,particles,audio,ui}.ts
  src/fog.ts        # NEW: radial visibility mask + per-role render gating
  src/comms.ts      # NEW: ping/waypoint signalling with a bandwidth cap
  src/modes.ts      # escort / defuse copy + config
  src/game.ts
```

## Open questions

- Biggest risk: is it fun or just frustrating? The fun lives entirely in the comms
  loop — prototype ESCORT first with programmer-art fog and playtest before polishing.
- How hard is the fog to render cheaply? A single cached radial-gradient mask
  composited with `destination-in` should be fine (no per-frame shadowBlur — the
  arcade already learned that lesson, see CHANGELOG perf fixes).
- Handoff/role-swap: ship it as an optional toggle, not default — it may dilute the
  "learn your role deeply" tension.
