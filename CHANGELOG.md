# Changelog

## 2026-07-01 (continued)

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
