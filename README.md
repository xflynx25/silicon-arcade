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
| **RICOCHET** | Competitive duel | Tilt paddles to deflect a neon ball — smash lunge and curve spin |
| **ECHO** | Rhythm co-op | Slide to your resonance arc, hit the pulse ring on beat — duo lock fills bloom |
| **VORTEX** | Sumo knockout | Charge-dash ships in a shrinking arena — knock your opponent out |

## Controls

Shared across all games:

- **Player 1:** `W A S D` move, `Left Shift` primary, `Space` secondary
- **Player 2:** `Arrow keys` move, `Right Shift` (or `/`) primary, `Enter` secondary
- **Global:** `Enter` start, `R` restart, hold `H` for the in-game How to Play card

### RICOCHET specifics

- P1: `W/S` slide paddle, `A/D` tilt
- P2: `↑/↓` slide paddle, `←/→` tilt

### ECHO specifics

- Each pulse ring spawns a **cyan arc (P1)** and **magenta arc (P2)** on the orbit
- `A/D` · `←/→` slide to your arc before the ring arrives
- `Shift` / `RShift` hit on the beat when ring and arc align; both players must lock for bloom
- `Space` / `Enter` focus slow-mo
- On title screen: `[` / `]` adjust tempo (50–100 BPM, default 65)

### VORTEX specifics

- Hold `Shift` / `RShift` to charge dash, release to lunge
- `Space` / `Enter` parry shield
