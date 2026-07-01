# Changelog

## 2026-07-01 (continued)

- **VORTEX**: fixed knockouts being impossible — the per-frame `constrainToArena` wall clamped ships inside the rim before the knockout check could ever fire, so players just bounced off an invisible wall. Removed the wall; the platform edge is now the death line (center past the rim = out), with a rendered platform disc and rim/ship "teetering" danger warnings so falling off reads clearly.
- **VORTEX**: fixed the crash/slowdown under heavy contact — hazard/ship collisions had no cooldown or separation, spawning ~1000 particles and ~120 audio oscillators per second while overlapping. Added hazard hit cooldown + positional separation, a live-hazard cap and lifetime (they no longer accumulate all round), a hard particle-pool cap, throttled collision audio, and dropped per-particle `shadowBlur` (the dominant render cost).
- **VORTEX**: parry is now a timed skill with a cooldown (was re-triggerable every frame), and a latent particle bug where `life`/`maxLife` were randomized independently (fade could exceed 1) is fixed.
- **RICOCHET**: added selectable game modes — title-screen picker (`1`/`2`/`3`) for **Duel** (unchanged competitive first-to-5), **Rally** (co-op: keep the ball alive, live + best rally counters, no scoring), and **Goals** (discrete moving/blinking goal zones per side instead of full-height walls; miss a zone and the wall holds).
- **RICOCHET**: enforced a minimum horizontal velocity fraction after every bounce/reflect/serve so steep-angle rallies still cross the arena instead of stalling top-to-bottom.
- **RICOCHET**: widened paddle tilt range (±0.85 → ±1.5 rad) and raised tilt speed (2.8 → 4.5 rad/s) for full wall-to-wall paddle rotation.
- **RICOCHET**: center HUD now shows the active mode label during Duel/Goals play instead of a misleading "Rally N" that reset every point.

- **ECHO**: slowed pacing — rings now take ~3.5 beats to reach the orbit, spawn every 2 beats, arcs spawn near your node, wider hit windows, faster slide; title-screen tempo control with `[` / `]` (50–100 BPM).
- **ECHO**: reworked into a real co-op rhythm game — each pulse ring spawns separate P1/P2 resonance arcs on the orbit; slide to your arc and hit on beat; both players must lock the same ring to fill bloom and ascend waves; edge-triggered hits, arc guides, and tighter wave scaling.
- **RICOCHET**: fixed paddle contact freezing the game — ball separation after a hit was smaller than the collision radius, causing hundreds of bounces per second (audio/particle spam).
- **POLARITY**: increased ball and player magnetic strength (~10×) and reduced ball drag so the shared core responds when ships close in and flip polarity.
- Added three new local 2-player games: `ricochet`, `echo`, and `vortex`.
- **RICOCHET** — competitive tilt-paddle deflection duel with smash lunge and curve spin; first to 5.
- **ECHO** — rhythm resonance game with generative beat, combo chains, shared bloom meter, and wave ascension.
- **VORTEX** — momentum sumo knockout in a shrinking circular arena with charge-dash and parry; best of 3.
- Wired workspace scripts (`dev:ricochet`, `dev:echo`, `dev:vortex`) and updated README.

## 2026-07-01

- Scaffolded a pnpm workspace containing two games: `tether` and `polarity`.
- Added Vite + TypeScript project setup for each game.
- Added shared engine modules in each game: fixed loop, input mapping, particles, synth audio, and HUD overlay.
- Implemented `TETHER`: elastic dual-player physics, slingshot reeling, solo light pickups, synchronized prism pickups, hazards, wave scaling, and stability-based survival loop.
- Implemented `POLARITY`: polarity flipping, dash cooldowns, magnetic ball control, player-vs-player magnetic interaction, goal scoring, timed rounds, and first-to-five victory condition.
- Expanded root run instructions and controls documentation in `README.md`.
