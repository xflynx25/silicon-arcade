# Silicon Arcade — Local 2-Player Games

Six local 2-player keyboard games in one workspace.

## Install

```bash
pnpm i
```

## Run

```bash
pnpm dev:tether
pnpm dev:polarity
pnpm dev:ricochet
pnpm dev:echo
pnpm dev:vortex
pnpm dev:nova
```

## Leaderboards (optional, no database)

High scores persist as **one JSON blob per game+board in Vercel Blob** — no
Postgres/Neon. Two serverless functions live at `/api/leaderboard` (`GET` lists the
top 20, `POST` submits `{ game, board, name, score }`). No auth; you just type
initials (arcade-style) when you make the board. **TETHER** is wired in first
(metric: seconds survived, one board per difficulty).

**The whole feature is optional and self-disabling.** If no leaderboard storage is
configured, the games run exactly as before with **no leaderboard UI at all** — no
board, no name prompt, no errors. So a fresh `git clone` + deploy Just Works; you
only turn leaderboards on when you want them.

- **Local dev — on by default:** a Vite plugin serves the endpoint from a
  gitignored `./.data/leaderboards/*.json` file, so `pnpm dev` / `pnpm dev:tether`
  have working leaderboards with zero setup and no cloud account.
- **Production — off until you link a store:** in the Vercel dashboard, create a
  **Blob** store and connect it to the project (Storage → Blob → Connect). Vercel
  then injects `BLOB_READ_WRITE_TOKEN` automatically — no code change. Until that
  token exists the API reports the leaderboard as disabled and the game hides it.
  (Confirm your Vercel project still builds the `/api` directory as functions.)
- **Optional write guard:** set `LEADERBOARD_TOKEN` (server env) and
  `VITE_LEADERBOARD_TOKEN` (same value, build-time) to require a shared-secret
  header on submissions — enough to deter random internet POSTs.
- **Add another game:** copy `tether/src/leaderboard.ts`, and on run-end call
  `getLeaderboard(game, board)` — only show leaderboard UI when it returns
  `enabled: true` — then `submitScore(...)` with the game's own id/board/metric.
  See `tether/src/game.ts` (`beginEndSequence` / `buildEndOverlay`) for the pattern.

## Games

| Game | Style | Summary |
|------|-------|---------|
| **TETHER** | Co-opetition | Spirits linked by an elastic tether — swing, slingshot, collect orbs |
| **POLARITY** | Competitive duel | Magnetic ships flip polarity to grab and shoot a shared charged ball |
| **RICOCHET** | Competitive duel / co-op / pong | Tilt paddles to deflect a neon ball — smash lunge, curve spin, and three selectable modes |
| **ECHO** | Co-op survival | Defend bases in the dark — ping to reveal foes, strike to destroy them, spread apart to resonate; two modes (Core / Grid) |
| **VORTEX** | Sumo knockout | Charge-dash ships in a shrinking arena — knock your opponent out |
| **NOVA** | Orbital duel / co-op | Comets orbit a star's gravity — slingshot for speed; ram to shatter your rival, or team up across three modes |

## Controls

Shared across all games:

- **Player 1:** `W A S D` move, `Left Shift` primary, `Space` secondary
- **Player 2:** `Arrow keys` move, `Right Shift` (or `/`) primary, `Enter` secondary
- **Global:** `Enter` start, `R` restart, hold `H` for the in-game How to Play card

### POLARITY specifics

- The shared core carries a charge — **opposite charges attract, like charges repel**
- Flip your polarity to pull the core toward you, then shove it into the rival's glowing gate
- `Space` / `Enter` **dash** — lunges you and briefly *grabs* the core toward you
- `E` / `.` **burst** — a shockwave that knocks the core and your rival away (cooldown)
- Any time: `[` / `]` adjust **Field Strength** (0.4×–2.5×) to make all forces weaker or stronger

### RICOCHET specifics

- P1: `W/S` slide paddle, `A/D` tilt
- P2: `↑/↓` slide paddle, `←/→` tilt
- On title screen: `1` Duel · `2` Rally · `3` Goals, then `Enter` to start
- **Duel** — competitive; first to 5 wins
- **Rally** — co-op; keep the ball alive together, live rally count + best rally tracked
- **Goals** — competitive pong with discrete goal zones per side (one moving, one blinking); miss the zone and the wall holds

### ECHO specifics

- Co-op survival in the dark — defend your base(s) through 6 waves of foes that crawl in from the black
- On title screen: `1` **Core** (one central Core) · `2` **Grid** (three scattered nodes — lose even one and the run ends), then `Enter` to start
- `Shift` / `RShift` **ping** — a sonar ring that lights up every foe it sweeps (they fade back to dark)
- `Space` / `Enter` **strike** — destroys foes close to you; position using what your pings reveal
- **Resonance rewards spreading out** — ping far apart from your partner and the rings blast the arena (the wider the gap, the bigger the hit); pinging on top of each other does nothing
- Stand on a hurt base to slowly **repair** it
- Foes: **drifters** crawl, **darters** are fast, **husks** and **brutes** are tanky, **broods** split into darters when killed, and **sirens** stop at range and drain your base from afar — camping won't save it, you have to go out and kill them
- Personal light shrinks as waves escalate, so late waves lean harder on your pings

### VORTEX specifics

- Hold `Shift` / `RShift` to charge dash, release to lunge
- `Space` / `Enter` parry shield

### NOVA specifics

- The central star's gravity constantly pulls both comets inward — thrust to steer your orbit
- **Dive close** to the star for a gravity-assist speed boost, then use it
- Hold `Shift` / `RShift` to charge a **Flare** burst, release to lunge along your aim (a direct hit wins in Duel)
- `Space` / `Enter` **Shield** — timed parry; blocks Flares and rams, perfect timing staggers your rival in Duel; in Rings, pulls nearby rings toward you
- Any time: `[` / `]` adjust **Gravity** (0.4×–2.5×)
- On title screen: `1` Duel · `2` Flares · `3` Rings, then `Enter` to start
- **Duel** — competitive, best of 5; **Flare-strike** or a fast ram (280+ speed, clearly faster) wins the round; Shield parries and perfect blocks stagger. Wider safe band than co-op — boundaries still kill
- **Flares** — co-op survival; corona **creeps inward** each wave, bolt patterns rotate (burst / spiral / crossfire), homing bolts from wave 3, telegraphed aimed shots. **Three shared lives** — respawn on hit. Tracks best survival time
- **Rings** — co-op collection; chain rings within 3s for combo bonus, **linked gold** needs both comets within 4s (+6), **risk rings** hug the corona (5 pts). Soft walls only — bounce resets combo
