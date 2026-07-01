---
name: Ricochet — feel fixes + game modes (Rally + Goals/Pong)
overview: "Fix Ricochet's core feel (min horizontal ball speed, full paddle rotation, sane scorekeeping), then turn the single hardcoded duel into a mode-driven game: a co-op RALLY mode that actually counts volleys, and a GOALS/PONG mode with dynamic goals (moving, multiple, disappearing)."
todos:
  - id: feel-fixes
    content: "Fix ball physics (enforce minimum horizontal velocity so bad angles cross quickly), widen + speed up paddle rotation, and clean up HUD/scorekeeping wording"
    status: pending
  - id: mode-arch
    content: "Introduce a GameMode abstraction + title-screen mode picker; refactor game.ts state so physics stays shared but objectives/scoring are per-mode"
    status: pending
  - id: rally-mode
    content: "Build RALLY (co-op friend) mode: shared volley counter that increments per successful hit, tracks best rally, ends on a miss, no player-vs-player scoring"
    status: pending
  - id: goals-mode
    content: "Build GOALS/PONG mode: discrete goal zones with variants — moving goals, multiple goals, disappearing (blinking) goals — plus scoring rules"
    status: pending
  - id: polish-verify
    content: "Audio/particle polish per mode, update README controls + CHANGELOG, smoke-test all three modes in the dev server"
    status: pending
isProject: false
---

# Ricochet: feel fixes + Rally & Goals/Pong modes

Ricochet today is a single hardcoded competitive duel in [ricochet/src/game.ts](ricochet/src/game.ts). This plan (1) fixes the three feel problems, then (2) restructures the game around selectable **modes** and adds a co-op **Rally** mode and a **Goals/Pong** mode with dynamic goals. Physics stays shared; only objectives/scoring/entities differ per mode.

## Part 1 — Core feel fixes (do first, benefits every mode)

### 1a. Ball crosses fast even at bad angles
**Problem:** `reflectBallOffSegment` and `resetBall` preserve speed magnitude but never guarantee horizontal progress. A near-vertical ball bounces top↔bottom ([game.ts:279-288](ricochet/src/game.ts#L279-L288)) making tiny X progress, so it "takes forever to get to the other side."

**Fix:** after any event that sets `ball.vel` (reflection, serve, wall bounce), enforce a **minimum horizontal fraction** of the speed. Add a helper:

```ts
// keep |vx| >= MIN_HX_FRAC of the total speed, preserving total speed
const enforceMinHorizontal = (ball: Ball, minFrac = 0.34): void => {
  const speed = len(ball.vel);
  if (speed < 1) return;
  const minVx = speed * minFrac;
  if (Math.abs(ball.vel.x) < minVx) {
    const sign = ball.vel.x >= 0 ? 1 : -1; // keep current direction
    ball.vel.x = sign * minVx;
    const vy2 = Math.max(0, speed * speed - ball.vel.x * ball.vel.x);
    ball.vel.y = Math.sign(ball.vel.y || 1) * Math.sqrt(vy2);
  }
};
```

Call it at the end of `reflectBallOffSegment` and in `resetBall`. `minFrac ≈ 0.34` caps the steepest angle at ~70° from horizontal — steep enough to be interesting, never a stalemate. Optional: also nudge the min/max clamp in [game.ts:113](ricochet/src/game.ts#L113) so the floor speed feels snappier.

### 1b. Full paddle rotation
**Problem:** `paddle.angle` clamped to `±0.85` rad at `2.8` rad/s ([game.ts:186](ricochet/src/game.ts#L186)) — under half of vertical and slow.

**Fix:** widen the clamp to `±1.5` rad (~±86°, effectively wall-flush to wall-flush) and raise tilt speed to ~`4.5` rad/s. Constants `PADDLE_MAX_ANGLE` and `PADDLE_TILT_SPEED`. (If we want literal full 360° spin we can drop the clamp entirely and let angle wrap — but ±1.5 is the sane pong-paddle range; note as a toggle.)

### 1c. Scorekeeping that makes sense
**Problem:** the only mode is a duel, yet the center HUD shows "Rally N" ([game.ts:431](ricochet/src/game.ts#L431)) which resets each point — reads as a broken co-op counter.

**Fix (duel):** center HUD shows serve state / current rally-of-this-point only as flavor, and `WIN_SCORE` becomes a per-mode config value. Left/right stay `P1 n` / `P2 n`. Real rally-counting lives in Rally mode (Part 3).

## Part 2 — Mode architecture

Add a lightweight mode layer so `game.ts` isn't three copies. Keep the shared simulation (paddles, ball, wall bounces, reflection, particles, shake) and vary the rest.

- New type in `game.ts` (or a small `modes.ts`):
  ```ts
  type ModeId = "duel" | "rally" | "goals";
  type ModeConfig = {
    id: ModeId;
    label: string;
    winScore?: number;              // duel
    onGoalZone?: (...) => void;     // goals mode scoring
    setup: (arena) => void;         // spawn goals / reset counters
    updateEntities?: (dt) => void;  // move/blink goals
    getHud: () => { left; center; right };
    getOverlayBody: () => string;
  };
  ```
- **Title screen mode picker:** number keys `1` Duel · `2` Rally · `3` Goals (extend `consumeGlobal` in [input.ts:54](ricochet/src/input.ts#L54) with `consumePress("Digit1/2/3")`). Selected mode shown on the title overlay; `Enter` starts the highlighted mode.
- `createGame` stores `currentMode`; `startRound`/`restartRound` call `mode.setup`; `update` runs shared sim then `mode.updateEntities` + mode scoring; `getHud`/`getOverlay` delegate to the mode.
- This keeps the diff contained to `game.ts` (+ optional `modes.ts`), `input.ts`, `ui.ts` (mode highlight), and README.

## Part 3 — RALLY mode (the "friend version", done right)

Co-op: both players keep one ball alive; the goal is the longest shared volley.

- **Counting fix:** a persistent `rallyCount` that increments **once per successful paddle hit** (reuse the reflect return value; don't reset per wall bounce). Track `bestRally`. The current code's `ball.rally` resets on every serve — Rally mode keeps its own counter that only resets when the rally actually ends.
- **End condition:** ball passes **either** wall = miss → rally ends, flash the final count, save `bestRally`, brief pause, auto-serve the next rally. No P1-vs-P2 scoring.
- **Escalation/juice:** ball speed ramps gently with `rallyCount` (already partly present via `boost`), trail/glow intensifies, milestone tones (e.g. every 5 hits) using `audio.spin`/`score`. Optional shrinking paddles at high counts for difficulty.
- **HUD:** center = `Rally N` (live), corners = `Best M`. Overlay explains "Keep it alive together."

## Part 4 — GOALS / PONG mode (dynamic goals)

Replace the full-height wall goals with discrete **goal zones** the ball scores in, with configurable variants. Ship one mode with a rotating/combinable set of goal behaviors.

**Goal entity:**
```ts
type Goal = {
  pos: Vec; w: number; h: number;
  owner?: 1 | 2 | null;    // whose to defend, or null = neutral target
  points: number;
  vy?: number;             // moving goals: bounce along its wall
  blink?: { period: number; onFrac: number; t: number }; // disappearing
  hue: number;
};
```

**Variants (each a flag on the mode; can mix):**
- **Moving goals** — goal slides up/down its wall (`pos.y += vy*dt`, reflect at bounds); ball only scores while overlapping.
- **Multiple goals** — several smaller goals per side, optionally different `points` (small/far = worth more).
- **Disappearing goals** — `blink` timer toggles a goal on/off; scoring only counts while visible; render fades so players can time it.

**Scoring flavors (pick default, keep others as config):**
- *Competitive pong:* each player defends their side's goal(s) and attacks the opponent's; ball into an opponent goal = point; first to `winScore`.
- *Co-op targets:* neutral goals scattered in the arena; both players cooperate to knock the ball through as many as possible before a timer — hitting a goal respawns/moves it. (Nice pairing with Rally mode's spirit.)

Default recommendation: **competitive pong with one moving goal per side**, then let `2`-vs-`3` on the title toggle between the goal-behavior presets so the "cool stuff" is discoverable.

**Collision:** simple AABB-vs-circle test each frame; on score call the existing `scoreGoal`/particle/shake path, then reposition/respawn the goal per its variant.

**Rendering:** goals as glowing framed rectangles (reuse the `shadowBlur` + `lighter` bloom style already in `render`), color by `owner` hue, fade by blink state.

## Files touched
- [ricochet/src/game.ts](ricochet/src/game.ts) — physics fixes, mode plumbing, rally counter, goal entities/rendering (bulk of the work).
- Optional new `ricochet/src/modes.ts` — mode configs/registry if `game.ts` gets crowded.
- [ricochet/src/input.ts](ricochet/src/input.ts) — mode-select keys.
- [ricochet/src/ui.ts](ricochet/src/ui.ts) — title mode highlight (minor).
- [ricochet/src/audio.ts](ricochet/src/audio.ts) — optional milestone/goal SFX.
- `README.md` / `CHANGELOG.md` — document modes + controls.

## Suggested order
1. Part 1 feel fixes (independent, immediately improves the current duel).
2. Part 2 mode scaffold with Duel as the first registered mode (no behavior change, proves the abstraction).
3. Part 3 Rally mode.
4. Part 4 Goals/Pong mode, starting with static goals → add moving → disappearing → multiple.
5. Polish + README/CHANGELOG + smoke test all three via `pnpm dev:ricochet` (or the ricochet dev script).

## Open questions (defaults chosen if unanswered)
- Goals mode default: **competitive pong** (vs co-op targets) — assumed unless you prefer co-op.
- Paddle rotation: **±86° clamp** (vs literal full 360° spin) — assumed.
- Keep the existing Duel mode alongside the two new ones — assumed yes.
