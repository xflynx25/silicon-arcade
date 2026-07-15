# PREPLANS — new-game brainstorm

Rough, exploratory design docs for the **next 3 games**. These are brainstorm
sketches (not committed builds); the real `*.plan.md` files graduate up one level
into `PLANS/` once a design is locked.

Every one of the 9 current games (TETHER, POLARITY, RICOCHET, ECHO, VORTEX,
NOVA, LATTICE, SALVO, CIPHER) is a **real-time twitch / physics** game on the same
Canvas + TypeScript + WebAudio stack, with symmetric P1/P2 roles. So the design
brief for these three was deliberately: *pick an axis none of the 9 touch.*

| # | Game | New axis it opens up | Status |
|---|------|----------------------|--------|
| 1 | **GHOST** | **Time** — record a lap, then race/fight your own past selves | 🔨 actively built |
| 2 | **RELAY** | **Information asymmetry** — the two keyboards see different things and must talk | brainstorm |
| 3 | **CADENCE** | **Rhythm / audio** — beat-locked play, not spatial twitch (reclaims the genre ECHO dropped) | brainstorm |

Each file: why it's new vs. the existing 9, the one core mechanic, controls,
modes, scoring, juice, leaderboard board, folder layout, and a todo skeleton.

Shared conventions inherited from the arcade (see repo `README.md`):
- P1 `WASD` + `LShift` (primary) + `Space` (secondary); P2 arrows + `RShift`/`/` + `Enter`.
- Title-screen mode picker `1`/`2`/`3`, `Enter` start, `R` restart, hold `H` for How-to-Play.
- Zero runtime deps: pure Canvas 2D + WebAudio synth, fixed-timestep loop, pooled particles.
- Leaderboards are the opt-in Vercel-Blob pattern (self-disabling); wire one board per game.
