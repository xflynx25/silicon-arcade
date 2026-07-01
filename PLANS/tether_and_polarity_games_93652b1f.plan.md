---
name: Tether and Polarity games
overview: "Build two original 2-player local-keyboard games in separate folders on a Vite + TypeScript + Canvas stack: TETHER (physics-tether co-opetition) and POLARITY (magnetic competitive duel), each with juicy visuals and zero-dependency synth audio."
todos:
  - id: scaffold
    content: Create pnpm workspace root (package.json, pnpm-workspace.yaml, README, CHANGELOG) and two game folders with index.html, package.json, tsconfig, vite.config
    status: completed
  - id: engine
    content: "Implement shared engine primitives in each folder: vec, fixed-timestep loop, input (P1/P2), pooled particles, WebAudio synth, UI overlay + bloom/screen-shake rendering"
    status: in_progress
  - id: tether
    content: "Build TETHER: spring-tether physics, reel-in/slingshot action, light orbs + prism co-op orbs, hazards, escalating waves, scoring/HUD, juice"
    status: pending
  - id: polarity
    content: "Build POLARITY: magnetic ship physics, polarity flip + dash, shared charged ball, goals, best-of round loop, scoring/HUD, juice"
    status: pending
  - id: verify
    content: Wire root run scripts, write controls/run instructions in README, and smoke-test both dev servers render and respond to keys
    status: pending
isProject: false
---

# Two Games: TETHER + POLARITY

Blank repo, full from-scratch build. Two independent games in two folders, sharing the same lightweight engine pattern (custom canvas + fixed-timestep loop + WebAudio synth). No runtime dependencies; Vite + TypeScript only as dev tooling.

## Repo layout

pnpm workspace at the root so a single `pnpm i` installs both, but each game lives in its own self-contained folder and runs on its own dev server.

```
gf-game/
  package.json              # workspace root, scripts to run each game
  pnpm-workspace.yaml
  CHANGELOG.md
  README.md                 # how to run each game + controls
  tether/                   # game 1
    index.html
    package.json  tsconfig.json  vite.config.ts
    src/{main,input,loop,vec,particles,audio,ui}.ts
    src/game.ts             # tether-specific state machine + entities
  polarity/                 # game 2
    index.html
    package.json  tsconfig.json  vite.config.ts
    src/{main,input,loop,vec,particles,audio,ui}.ts
    src/game.ts             # polarity-specific state machine + entities
```

Note: I will NOT install packages myself. After I write the files, you run `pnpm i` (per your rule). Dev deps per game: `vite`, `typescript`. Zero runtime deps (pure Canvas + WebAudio).

## Shared engine primitives (small, duplicated per folder to keep each self-contained)

- `vec.ts`: 2D vector math (add/sub/scale/len/normalize/clamp) for physics.
- `loop.ts`: fixed-timestep accumulator loop over `requestAnimationFrame` so physics is deterministic regardless of monitor refresh rate.
- `input.ts`: `keydown`/`keyup` into a held-key set; `preventDefault` on arrows/space so the page doesn't scroll. Split into P1 (left-hand) and P2 (right-hand) bindings.
- `particles.ts`: pooled particle system (sparks, trails, bursts) for the "juice".
- `audio.ts`: WebAudio oscillator-based SFX + a simple generative ambient/beat layer (no audio files, no deps).
- `ui.ts`: title screen, controls overlay, per-round HUD, win screen (DOM overlay on top of canvas).
- Rendering polish: `ctx.shadowBlur` glow + additive `globalCompositeOperation = 'lighter'` for bloom-style light, subtle screen shake, and a slow starfield/grid background.

## Controls (shared keyboard)

- Player 1 (left): `W A S D` move/thrust, `Left Shift` = primary action, `Space` = secondary.
- Player 2 (right): `Arrow keys` move/thrust, `Right Shift` (or `/`) = primary action, `Enter` = secondary.
- Global: `Esc`/`Enter` to start, `R` to restart round.

## Game 1 — TETHER (co-opetition)

Two glowing spirits joined by an elastic energy tether. The tether is a damped spring constraint (Hooke's law) with a max length; it pulls the partners together when stretched, enabling swings and slingshots.

- Physics: each spirit = position/velocity with thrust + drag; tether applies equal-and-opposite spring force `F = -k*(dist - rest) - c*relVel`, clamped so it can't exceed max length.
- Primary action = "reel in" (shorten rest length) to store tension; releasing slingshots. This is the novel skill core: swing around anchors, fling your partner across gaps, or yank them off a hazard.
- Objectives (co-opetition): collect drifting light orbs (personal score) while surviving shared hazards (spike fields, drifting voids, closing walls). Some "prism" orbs only unlock when both spirits touch them within a short window -> forces cooperation. Shared survival timer + individual light tally shown at round end ("together you survived X; you collected the most light").
- Feel: tether renders as a bright animated cord with sag; sparks on collect; screen shake on near-miss; ambient pad that intensifies with tether tension.
- Content: 3-4 escalating procedural waves; simple, endless-friendly.

## Game 2 — POLARITY (competitive duel, fresh twist)

A magnetic arena duel. Each player pilots a ship that can flip magnetic polarity (positive/negative). A shared charged ball is attracted or repelled by each ship based on current polarity; you also attract/repel each other. Score by driving the ball into the opponent's goal zone.

- Novel core: `primary action` = flip polarity; force on ball from each ship = magnetic inverse-square (softened) scaled by polarity signs. Same-sign repels, opposite attracts. Skill = flipping polarity to "grab" the ball (attract), then flip to "shoot" (repel) toward their goal.
- `secondary action` = short dash (brief thrust burst on cooldown) for positioning/checks.
- Structure: round-based, first to 5, 90s arena with soft walls the ball bounces off; ball speeds/glows up over a rally; goal flashes + screen shake + rising synth stinger on score.
- Feel: polarity shown as blue/orange aura; field lines between ship and ball; trails on fast ball; announcer-style tones per goal.

## Tooling details

- Each game `vite.config.ts`: default root, `server.open` off (they open the printed URL). No special config needed.
- `tsconfig.json`: strict TS, `moduleResolution: bundler`, target ES2022.
- Root `package.json` scripts: `dev:tether` -> `pnpm --filter tether dev`, `dev:polarity` -> `pnpm --filter polarity dev`.
- `CHANGELOG.md`: seed with initial entry documenting both games (per your documentation-discipline rule).

## After build

I'll tell you exactly what to run: `pnpm i`, then `pnpm dev:tether` or `pnpm dev:polarity`, and I can start a dev server to smoke-test rendering/loop once you've installed.