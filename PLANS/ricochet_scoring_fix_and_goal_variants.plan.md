---
name: Ricochet — fix scoring, add mode config, richer goal variants
overview: "The previous Ricochet modes plan was implemented but is broken: a leftover paddle-plane wall bounces the ball back before it can ever reach the scoring zone, so NO mode ever scores. This plan (1) fixes the scoring bug at the root, (2) turns the bare 1/2/3 mode toggle into a real config setup (duel vs co-op rally vs goals, plus per-mode options like win score and goal-variant presets), and (3) expands Goals mode into a proper 'sectional goal' mode with selectable behaviors: moving goals, move-on-hit goals, and multiple goals."
todos:
  - id: fix-scoring-wall
    content: "Fix the core scoring bug: remove/repurpose the paddle-plane hard wall (game.ts:478-485) that prevents the ball from ever reaching the goal/exit zone in every mode"
    status: pending
  - id: verify-all-modes-score
    content: "Confirm duel scores when ball passes a player, rally ends+counts on a miss, and goals mode scores only through visible goal zones"
    status: pending
  - id: mode-config-ui
    content: "Turn the 1/2/3 toggle into a clear config screen: highlighted mode selection, per-mode options (win score, goal-variant preset), and readable on-screen explanation of duel vs co-op"
    status: pending
  - id: goal-variants
    content: "Expand Goals mode into selectable sectional-goal presets: moving goal(s), move-on-hit goal, multiple goals — driven by a small variant config"
    status: pending
  - id: polish-doc
    content: "Audio/particle polish per mode, update README + CHANGELOG, smoke-test every mode and preset via the ricochet dev server"
    status: pending
isProject: false
---

# Ricochet: scoring fix + mode config + sectional goal variants

The earlier plan (`ricochet_modes_and_pong.plan.md`) shipped the mode scaffolding,
the physics helpers, and a first Goals mode — but a single leftover line block
silently breaks scoring in **all three modes**, which is why "it doesn't give
points when we get it past the other person" and why the mode picker feels
pointless (every mode plays like an endless volley).

This plan is bug-fix-first, then config, then the richer goal behaviors you asked for.

## Part 1 — Fix the scoring bug (do first; unblocks everything)

### The bug
Each frame the ball update does, in order:
1. move ball
2. top/bottom wall bounce
3. left/right **scoring/exit** check at `leftWall - GOAL_DEPTH` (x ≈ 20)
   — duel/rally `onBallExit`, goals `tryScoreGoalZone`
4. paddle reflection
5. a **paddle-plane hard wall** at `leftWall` / `rightWall` (x = 48),
   [game.ts:478-485](ricochet/src/game.ts#L478-L485):
   ```ts
   if (ball.pos.x - BALL_R < leftWall && ball.vel.x < 0) {
     ball.pos.x = leftWall + BALL_R;   // snap to x = 56
     ball.vel.x = Math.abs(ball.vel.x); // and bounce back
   }
   ```

Step 5 sits **in front of** the scoring zone from step 3 (48 > 20). So any ball
that gets past a paddle is snapped back to x = 56 and reversed *before* it can
ever drift to x ≈ 20. The exit/goal check in step 3 therefore never fires →
**no one ever scores, in any mode.**

### The fix
The paddle is the only defense; if it misses, the ball must be allowed to travel
into the goal depth and score. **Remove the step-5 hard-wall block entirely**
(both left and right). After removal:
- **Duel / Rally:** ball passes the paddle → reaches x < `leftWall - GOAL_DEPTH`
  → `onBallExit` fires → point (duel) or rally-end (rally). ✅
- **Goals:** ball passes the paddle → the *back* wall bounce already at
  [game.ts:418-435](ricochet/src/game.ts#L418-L435) handles a miss (bounce at
  `leftWall - GOAL_DEPTH`), and `tryScoreGoalZone` handles a hit through a
  visible zone. ✅

If we still want a safety net against the ball tunneling fully out of the canvas
on a huge dt, gate a clamp to the *outer* edge only (e.g. `x < BALL_R` /
`x > w - BALL_R`) instead of the paddle plane — never at `leftWall`/`rightWall`.

### Widen the goal depth a touch
`GOAL_DEPTH = 28` leaves only ~20px of travel behind the paddle before scoring —
fine functionally, but bump to ~40–48 so the "it went in" moment reads clearly
and the goal zones in Goals mode have room to render. Cosmetic, do alongside the fix.

## Part 2 — A real mode-config setup (duel vs co-op vs goals)

Today mode selection is a bare `1 Duel · 2 Rally · 3 Goals` line and, because
scoring was broken, the modes were indistinguishable. Once Part 1 lands, make the
choice deliberate and legible.

**Title/config screen (in `getOverlay` + `input.ts`):**
- Keep `1/2/3` to pick the mode, but render the **selected** mode highlighted and
  show a one-line "what this is" under it:
  - **Duel** — competitive, first to N.
  - **Rally** — co-op, one shared ball, chase your best rally.
  - **Goals** — competitive, score only through the goal sections.
- Add lightweight per-mode options on the same screen (consume digit/bracket keys
  only while `phase === "title"`):
  - **Duel & Goals:** win score `N` — `[` / `]` to adjust (3 / 5 / 7 / 11), replace
    the hardcoded `WIN_SCORE = 5` at [game.ts:9](ricochet/src/game.ts#L9) with a
    `winScore` field on game state.
  - **Goals:** goal-variant **preset** selector (see Part 3) — e.g. `4/5/6` or
    a single "cycle preset" key, shown as `Preset: Moving / Move-on-hit / Double`.
- Structure this as a small `ModeConfig` object so state (`winScore`,
  `goalPreset`) lives in one place rather than scattered constants. `modes.ts`
  already holds `MODE_LABEL` / `MODE_HELP`; extend it with the option metadata.

**Why co-op vs duel felt missing:** Rally already *is* the co-op mode and Duel is
the competitive one — the distinction just never surfaced because nothing scored.
After Part 1, make sure the HUD makes it obvious: Rally shows `Rally N` / `Best M`
(co-op framing, no P1/P2), Duel/Goals show `P1 n` / `P2 n`.

## Part 3 — Sectional goals with selectable behaviors

You want "instead of the whole side being the goal, only a section is the goal —
and maybe it moves, or moves each hit, or there are two of them." Goals mode
already has the `Goal` entity with `vy` (moving) and `blink` (disappearing) and a
`respawnGoal` that relocates on hit. The work is to make these **selectable
presets** rather than one hardcoded mix, and to add the "move-on-hit" behavior
explicitly.

Define presets (a `goalPreset` on the mode config; `makeGoals()` switches on it):

| Preset | Layout | Behavior |
|--------|--------|----------|
| **Static section** | one centered goal per side | fixed target, wall holds elsewhere (simplest — good default to prove scoring) |
| **Moving** | one goal per side | slides up/down its wall, reflecting at bounds (`vy` already implemented) |
| **Move-on-hit** | one goal per side | stationary until scored through, then jumps to a new random y (extend `respawnGoal`, set `vy = 0`) |
| **Double** | two smaller goals per side | both scoreable; optionally worth different points (far/small = more) |
| **Disappearing** | one/two per side | blink on/off; only scores while visible (`blink` already implemented) |

Notes:
- Keep the collision as-is: on the back-wall exit check, `tryScoreGoalZone`
  tests `ball.pos.y` against each visible goal's `[y-h/2, y+h/2]` band. This
  already works once Part 1 unblocks the ball reaching the zone.
- "Move-on-hit" is mostly free: it's the current `respawnGoal` with `vy = 0` and
  no blink — the goal only relocates when actually scored through.
- For **Double** with different point values, add `points` to `Goal` and pass it
  to `scoreGoal` (currently always +1).
- Optional co-op flavor (pairs with Rally's spirit): a preset with **neutral**
  goals scattered mid-arena that both players try to hit for a shared score
  before a timer — nice-to-have, not required for this pass.

Default recommendation: ship **Static section** as the Goals default (proves the
fix cleanly), with **Moving**, **Move-on-hit**, and **Double** as cycleable
presets so the "cool stuff" is discoverable from the config screen.

## Files touched
- [ricochet/src/game.ts](ricochet/src/game.ts) — remove paddle-plane wall (Part 1),
  `winScore`/`goalPreset` state, preset-driven `makeGoals`, move-on-hit + points in
  `scoreGoal`/`respawnGoal`, HUD/overlay config wording.
- [ricochet/src/modes.ts](ricochet/src/modes.ts) — per-mode option metadata,
  preset labels/help text.
- [ricochet/src/input.ts](ricochet/src/input.ts) — win-score keys (`[`/`]`) and
  preset-cycle key, title-only.
- [ricochet/src/ui.ts](ricochet/src/ui.ts) — title config highlight (minor).
- `README.md` / `CHANGELOG.md` — update controls + mode/preset docs.

## Suggested order
1. **Part 1** remove the paddle-plane wall + widen `GOAL_DEPTH`; smoke-test that
   duel scores, rally ends on a miss, goals scores through a zone. (Fixes the
   reported bug on its own.)
2. **Part 2** config screen + `winScore` option + HUD framing so duel/co-op read
   clearly.
3. **Part 3** goal presets: Static → Move-on-hit → Moving → Double.
4. Polish, README/CHANGELOG, full smoke test via the ricochet dev server.

## Open questions (defaults chosen if unanswered)
- Goals default preset: **Static section** (vs jumping straight to Moving) — assumed.
- Win-score options `3/5/7/11`, default **5** — assumed.
- Keep Rally as the co-op mode rather than adding a separate co-op-goals mode this
  pass — assumed yes (co-op-goals listed as optional).
