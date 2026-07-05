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
- Hold `Shift` / `RShift` to charge a **Flare** burst, release to lunge along your aim
- `Space` / `Enter` **Shield** — a timed parry (reflects a ram / parries a bolt; cooldown)
- Any time: `[` / `]` adjust **Gravity** (0.4×–2.5×)
- On title screen: `1` Duel · `2` Flares · `3` Rings, then `Enter` to start
- **Duel** — competitive, best of 5; the **faster comet shatters the slower one** on impact (near-matched speeds just bounce). Two death lines: burn up in the star's **corona** or drift past the **void** edge
- **Flares** — co-op survival; the star ejects plasma **bolts** you dodge (or parry with Shield) together. Corona and void are still lethal. Endurance run — tracks best survival time
- **Rings** — co-op collection; fly either comet through glowing **rings** (gold rings worth 3) for a shared score against a 60s clock. Corona and void are soft walls here — no deaths, just flow
