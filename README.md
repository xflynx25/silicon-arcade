# GF Game — Local 2-Player Games

Five local 2-player keyboard games in one workspace.

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
```

## Games

| Game | Style | Summary |
|------|-------|---------|
| **TETHER** | Co-opetition | Spirits linked by an elastic tether — swing, slingshot, collect orbs |
| **POLARITY** | Competitive duel | Magnetic ships flip polarity to grab and shoot a shared charged ball |
| **RICOCHET** | Competitive duel / co-op / pong | Tilt paddles to deflect a neon ball — smash lunge, curve spin, and three selectable modes |
| **ECHO** | Rhythm co-op | Slide to your resonance arc, hit the pulse ring on beat — duo lock fills bloom |
| **VORTEX** | Sumo knockout | Charge-dash ships in a shrinking arena — knock your opponent out |

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

- Each pulse ring spawns a **cyan arc (P1)** and **magenta arc (P2)** on the orbit
- `A/D` · `←/→` slide to your arc before the ring arrives
- `Shift` / `RShift` hit on the beat when ring and arc align; both players must lock for bloom
- `Space` / `Enter` focus slow-mo
- On title screen: `[` / `]` adjust tempo (50–100 BPM, default 65)

### VORTEX specifics

- Hold `Shift` / `RShift` to charge dash, release to lunge
- `Space` / `Enter` parry shield
