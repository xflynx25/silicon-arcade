# Changelog

## 2026-07-06

- **LEADERBOARDS**: added old-arcade high-score leaderboards with no database. Scores persist as **one JSON blob per game+board in Vercel Blob** (no Neon/Postgres), served through two tiny zero-config serverless functions at `/api/leaderboard` (`GET` to list top 20, `POST` to submit `{ game, board, name, score }`). No auth — just type your initials (A–Z / 0–9, arcade-style) when you make the board. A Vite dev plugin (`scripts/leaderboard-dev-plugin.ts`) serves the identical contract from a local `.data/` file so `pnpm dev` works with no cloud. Shared pure logic lives in `api/_leaderboard-core.ts` (validation, sort, trim) so dev and prod behave the same. **TETHER** is wired first: metric is seconds survived, one board per difficulty (easy/normal/hard); the Run Complete overlay now shows the board and prompts for initials on a qualifying run. Other games opt in by importing the same client helper. Optional `LEADERBOARD_TOKEN` shared secret guards writes. Requires a Blob store linked to the Vercel project (see README).

## 2026-07-05

- **NOVA**: sharpened the three mode identities so each mode has a distinct verb — **Fight**, **Survive**, **Collect**. **Duel** now awards rounds on **Flare-strike** hits (not just ram/boundary), lowered ram kill thresholds (280+ speed, 1.15× ratio), perfect Shield parries **stagger** the attacker, and the playable band is slightly wider. **Flares** adds corona creep each wave, rotating bolt patterns (burst / spiral / crossfire), telegraphed aimed shots, slow homing bolts from wave 3, and **three shared lives** with respawn. **Rings** adds combo chains (3s window, wall bounce resets), linked gold pairs (+6 when both comets collect within 4s), risk rings near the corona (5 pts), and Shield **magnet pulse** on nearby rings. Extracted mode copy to `nova/src/modes.ts` with per-mode help text; updated title menu, HUD (lives, combo), and README.
- **ECHO**: anti-camp gameplay update — camping both players on the Core and spamming was the dominant strategy, so the whole game now punishes it. Added a title-screen mode picker (`1`/`2`, à la ricochet): **Core** is the classic single central base, **Grid** scatters three nodes in a triangle and foes swarm the nearest — you can't hold them from one spot, and losing even one node ends the run. Reworked **resonance** to reward spreading out: pings closer than a minimum separation no longer connect, and blast radius/damage scale with how far apart the two origins are (plus a short global cooldown so it can't chain every frame). Added three enemy types: **sirens** park at range and drain a base from afar (self-revealed while channeling — you must leave the base and hunt them), **broods** burst into a spray of darters when killed (so point-blank kills at a base backfire), and heavy **brutes** that shrug off single strikes and reward sustained fire/resonance. Standing on a hurt base slowly **repairs** it, personal light shrinks as waves escalate (late waves lean on pings), and the HUD/overlay/render are mode-aware with per-base health rings, threat warnings, and siren drain beams. Generalized the single `coreHealth` scalar into a `bases` array throughout.

## 2026-07-03 (continued)

- **POLARITY**: fixed the playing field rendering in a tiny top-left corner on HiDPI/Retina displays — screen-shake used `setTransform`, which wiped out the device-pixel-ratio scale applied at startup.
- **POLARITY**: toned down dash/burst VFX to stop frame stalls — removed per-particle and entity `shadowBlur`, capped the particle pool, replaced the expanding dash grab ring with a static fade ring, and simplified shockwave/trail draws (same pattern as vortex/tether).
- **ECHO**: removed `shadowBlur` from expanding ping rings, enemies, core, and players; capped particles and switched to cheap dual-disc glows.
- **RICOCHET**: capped the particle pool (320) and fixed `life`/`maxLife` drift so burst moments cannot balloon the pool.
- **ECHO**: full redesign from a one-axis rhythm game into **Blackout**, a co-op survival game driven by echolocation. Two players defend a shared **Core** at the center of a dark arena through 6 escalating waves of husks (drifters, fast darters, tanky husks) that crawl in from the black and are invisible until revealed. **Ping** (primary) fires a sonar ring that lights up and knocks back every husk it sweeps; **Strike** (secondary) destroys husks in melee range — you position by memory of what your pings revealed. When both players' pings overlap they **resonate**, flashing the whole arena and blasting everything nearby (carrying over Echo's old "both players lock together" identity). Husks that reach the Core bite its health; drop it to zero and the dark wins. Removed the entire BPM/beat/tempo system (audio beat scheduler, `onBeat`, tempo controls) and rewrote the game, input, audio, and main wiring around the new loop.
- **NOVA**: added a sixth game — an orbital slingshot duel. A central star exerts real gravity on two comets; players thrust to shape their orbit, dive close for a gravity-assist speed boost, and ram their rival — the faster comet shatters the slower one, near-matched speeds just bounce. Reuses the vortex feel: hold `Shift`/`RShift` to charge a **Flare** lunge, `Space`/`Enter` for a timed **Shield** parry that reflects a ram. Two death lines — burn up in the star's corona or drift past the void edge — plus a live `[`/`]` **Gravity** knob (0.4×–2.5×). Title-screen picker (`1`/`2`/`3`): **Duel** (competitive best of 5), **Flares** (co-op survival vs plasma bolts, lethal corona/void, best time), **Rings** (co-op ring collection on a 60s clock, soft bounce walls). Wired `dev:nova` and the workspace, updated README.

## 2026-07-03

- **POLARITY**: rewrote the how-to-play card to actually explain the magnetism (opposite charges attract, like charges repel; flip to pull the core in and shove it at the rival's gate).
- **POLARITY**: added a live-tunable **Field Strength** knob (`[` / `]`, 0.4×–2.5×) that scales every magnetic force — core pull, player-vs-player pull, and burst — so effects can be dialed weaker or stronger; shown in the HUD and on the title/end cards.
- **POLARITY**: reworked **Dash** into a scoop — for a short window after dashing the core is pulled hard toward you regardless of polarity, so a well-timed dash grabs it. Fixed the force sign so the grab attracts rather than repels.
- **POLARITY**: added a second ability, **Burst** (`E` / `.`), a cooldown shockwave that knocks the core and your rival radially away; player rings show grab flare and burst recharge.

## 2026-07-01 (continued)

- **TETHER**: replaced passive stability drain with health — void contact starts a slow bleed, and a co-op prism pickup stops it.
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
