---
name: CADENCE — rhythm call-and-response duel
overview: "Build CADENCE, the arcade's 10th game and its first that rewards TEMPORAL precision (hitting on the beat) rather than spatial twitch. A local 2-player rhythm game on the same Vite + TypeScript + Canvas + WebAudio stack, but built on a genuinely new engine primitive: a sample-accurate beat clock driven off `audioCtx.currentTime` with a lookahead scheduler and a perfect/good/miss hit judge, plus a first-run latency calibration. Two modes: TRADE (co-op call-and-response) and CLASH (competitive beat battle). Reclaims the rhythm genre ECHO abandoned when it pivoted to survival (CHANGELOG 2026-07-03)."
todos:
  - id: scaffold
    content: "New cadence/ folder from the standard game template (index.html, package.json, tsconfig, vite.config, src/{main,input,loop,vec,particles,ui,audio}.ts). Register everywhere: pnpm-workspace.yaml, root package.json dev:cadence, scripts/assemble-dist.mjs games[], and BOTH registries in arcade/main.ts (card + leaderboard). README + CHANGELOG stubs."
    status: pending
  - id: clock
    content: "src/clock.ts — the real work. WebAudio beat clock on audioCtx.currentTime (not rAF), a lookahead scheduler that queues notes ~100ms early, a beat/bar model, and a hit judge (perfect/good/miss windows around each note's target time). This is a new arcade engine primitive; build it first behind a single-lane metronome tap test and prove it feels tight before anything else."
    status: pending
  - id: calibrate
    content: "src/calibrate.ts — first-run latency calibration flow (tap along to a metronome, average the offset, persist to localStorage). Judge subtracts the stored offset. Reachable from the title screen. Non-negotiable for a fair rhythm game across setups."
    status: pending
  - id: music
    content: "src/music.ts — scale/chord engine so every on-beat hit maps to a consonant note in the current key (no wrong notes, only wrong times) + a layered generative synth (bass/arp/pad) whose layers unlock as accuracy is sustained. Built on the existing oscillator audio.ts pattern, scheduled against the clock."
    status: pending
  - id: modes
    content: "src/modes.ts + src/game.ts — TRADE (co-op call-and-response: one player performs a phrase, the other echoes it on the next bar; shared groove meter) and CLASH (competitive: independent accuracy + a rhythmic 'syncopation' attack that shifts the rival's notes off-grid). Title picker 1/2, BPM tune on title, calibration entry."
    status: pending
  - id: juice
    content: "Beat-synced visuals: whole scene pulses on the beat, grid flashes on downbeats, perfect-hit bloom, combo ribbon that thickens with the groove meter, brief desaturate on miss. All VFX scheduled against the audio clock. Title + hold-H How-to-Play + calibration screen."
    status: pending
  - id: verify
    content: "Latency calibration is honest end-to-end; leaderboard boards wired (longest-groove for TRADE, accuracy for CLASH) via @arcade/leaderboard; typecheck + full `pnpm build` (incl. assemble-dist) passes; CHANGELOG + README updated. User does manual play-test (no browser auto-verify per project rule)."
    status: pending
isProject: false
---

# CADENCE — the rhythm game, done right

CADENCE is game #10. Every one of the existing nine (TETHER, POLARITY, RICOCHET,
ECHO, VORTEX, NOVA, LATTICE, SALVO, CIPHER) rewards **spatial twitch** — aim,
dodge, collide. CADENCE rewards **temporal precision**: hitting on the beat. That
is a different skill and a different feeling (flow/groove, not reflex), which is
exactly why it earns a slot.

There's history: **ECHO** began as a co-op rhythm game and was rewritten into
stealth-survival (CHANGELOG 2026-07-03). The arcade *had* rhythm, learned that
timing is the whole ballgame, and dropped it. CADENCE is a clean second attempt
with a sharper hook — **call-and-response**: one player plays a short phrase, the
other **answers it** on the next bar. You trade licks and co-author a track,
instead of both hammering the same falling notes.

## The one thing that makes or breaks this: the audio clock

ECHO's rhythm attempt was fiddly because it judged timing off the animation loop.
CADENCE's core primitive, `src/clock.ts`, is built on the **WebAudio clock**:

- **Judge off `audioCtx.currentTime`** (sample-accurate). `requestAnimationFrame`
  is used only to *draw*; it never decides whether a hit landed.
- **Lookahead scheduler** — a `setInterval`/`setTimeout` "ticker" wakes every
  ~25ms and schedules every note/beat whose time falls within the next ~100ms
  directly onto WebAudio (`osc.start(when)`). Audio stays rock-solid regardless of
  frame rate. This is the classic *"A Tale of Two Clocks"* pattern.
- **Hit judge** — each incoming note carries a `targetTime`. On keypress we take
  `audioCtx.currentTime`, subtract the calibration offset, and diff against the
  nearest note in that lane → **perfect** (≈ ±35ms) / **good** (≈ ±75ms) / **miss**.
  Windows are tunable constants; the tap-test screen is how we tune them honestly.
- **Beat/bar model** — clock exposes `beatOfTime(t)`, `timeOfBeat(n)`, current BPM,
  bar length. Everything (notes, VFX, phrase boundaries) is expressed in beats, not
  seconds, so a BPM change re-times the whole game for free.

Build this **first**, behind a single-lane metronome + tap test. If a lone tap
doesn't feel tight and fair, nothing downstream matters — this is the go/no-go gate
the preplan calls out.

> **Why a new file and not `audio.ts`:** the existing `AudioSystem` (see
> [nova/src/audio.ts](nova/src/audio.ts)) is a fire-and-forget SFX + ambient-hum
> player — it plays sounds *now*, on demand. The clock needs *scheduled-ahead*,
> time-addressed events. Different job, different module. `audio.ts` stays for UI
> blips; `clock.ts` + `music.ts` own the musical timeline.

## Latency calibration (`src/calibrate.ts`) — non-negotiable

On first run (and reachable from the title), the player taps along to a bare
metronome for ~8 beats. We average `(pressTime − nearestBeatTime)`, discard
outliers, store the offset in `localStorage` (`cadence.latencyOffset`). The judge
subtracts it on every hit. Without this, the game feels "off" on any setup with a
different audio/display latency and players blame themselves unfairly. Ship a
"recalibrate" affordance so it's fixable if it drifts.

## Always-musical (`src/music.ts`)

A tiny **scale/chord engine**: define a key + scale (e.g. C minor pentatonic to
start — hard to make sound bad) and map each lane/beat to a consonant scale degree.
**You cannot play a wrong note, only a wrong *time*.** Layered generative synth on
the oscillator pattern already in `audio.ts`:

- Base: kick/hat pulse from the clock's downbeats.
- Sustained accuracy **unlocks layers** — bass, then arp, then pad — so a good run
  literally sounds *fuller*. Miss and layers drop out and the track thins.

That "the music grows as you nail it" loop is the emotional payoff and doubles as
the scoreboard you can *hear*.

## Modes (`src/modes.ts` + `src/game.ts`), title picker `1`/`2`

Follow the existing `modes.ts` convention exactly (see [nova/src/modes.ts](nova/src/modes.ts)):
export `CONTROLS`, `MODE_LABEL`, `MODE_TITLE_LINE`, `MODE_HELP` keyed by a
`ModeId = "trade" | "clash"`.

- **1 · TRADE (co-op call-and-response).** The game lights a short phrase on P1's
  lanes; P1 performs it; on the next bar P2 **echoes the same phrase** on their
  lanes. Bars alternate and phrases lengthen. Clean handoffs climb a shared
  **groove meter** and add music layers; misses thin the track. Telegraph the
  "listen" bar clearly — dim the *acting* player's lane and light the phrase — then
  the "repeat" bar. **Score = longest sustained groove** (in beats/bars).
- **2 · CLASH (competitive beat battle).** Notes stream to both lanes; each player
  scores their own accuracy. A **hot streak** charges a **"syncopation"** you can
  fire to briefly shift the *rival's* incoming notes off-grid — a fair, rhythmic
  attack (you disrupt their *timing*, never their controls). **Higher accuracy
  score after the track wins.**

## Controls (rhythm-appropriate, deliberately minimal)

Fewer inputs than the action games, by design — movement keys become **lane keys**:

- **P1:** `A S D` + `W` = up to four note lanes; `Left Shift` = accent/hold (sustains).
- **P2:** arrow keys = four lanes; `Right Shift` = accent/hold.
- **Global (title):** `[` / `]` tune **BPM** (60–140, mirrors ECHO's old tempo
  control), `Enter` start, `R` restart, hold `H` for How-to-Play, a key to open
  **Calibrate**.

**Keyboard-rollover risk:** cheap keyboards drop simultaneous keys. Keep required
*simultaneous* presses low — that's why lanes stay ≤4 per player and phrases favor
sequential notes over chords.

## Feel / juice

- The whole scene **pulses on the beat** — arena breathes, background grid flashes
  on downbeats (cheap, hugely effective for rhythm feel).
- Perfect hits **bloom**; a combo builds a visible **waveform/ribbon** that thickens
  with the groove meter; misses briefly **desaturate**.
- **All VFX are scheduled against the audio clock**, so visuals sit *on* the music
  rather than trailing it by a frame.

## Leaderboard

Uses the existing `@arcade/leaderboard` client (see [shared/src/index.ts](shared/src/index.ts)):
`getLeaderboard(game, board)` / `submitScore(game, board, name, score)` / `qualifies(...)`.
Mirror the NOVA integration in [nova/src/game.ts](nova/src/game.ts) (`LEADERBOARD_GAME`,
per-mode `boardKey`, name-entry state on the game-over overlay, fail-soft).

- `LEADERBOARD_GAME = "cadence"`.
- **Two boards:** `trade` (metric = longest groove, higher better) and `clash`
  (metric = accuracy score). One board per mode, opt-in Blob pattern, self-disabling
  when no store is configured.

## Folder layout

```
cadence/
  index.html  package.json  tsconfig.json  vite.config.ts
  src/{main,input,loop,vec,particles,ui,audio}.ts   # standard template files
  src/clock.ts       # NEW: WebAudio beat clock + lookahead scheduler + hit judge
  src/music.ts       # NEW: scale/chord engine + layered generative synth
  src/calibrate.ts   # NEW: latency calibration flow
  src/modes.ts       # trade / clash copy + config (CONTROLS/MODE_* exports)
  src/game.ts        # state machine, mode logic, leaderboard wiring
```

`main.ts` follows the standard boot (see [nova/src/main.ts](nova/src/main.ts)):
create canvas + ctx, `InputManager`, `Hud`, `AudioSystem`, DPR-aware resize,
`createGame(w,h)`, `createFixedLoop`. The one addition: `main.ts` also constructs
the beat clock and hands both the clock and audio into `createGame`, and the render
step reads `clock.currentBeat` for beat-synced drawing.

## Every registration point (so it actually appears and builds)

This repo wires each game in several places — miss one and it won't run, launch, or
ship. Concretely:

1. **`pnpm-workspace.yaml`** — add `- "cadence"` to `packages`.
2. **Root `package.json`** — add `"dev:cadence": "pnpm --filter cadence dev"`.
   Add `@arcade/leaderboard: workspace:*` to `cadence/package.json` deps.
3. **`scripts/assemble-dist.mjs`** — add `"cadence"` to the `games` array so the
   built `cadence/dist` is copied into root `dist/cadence` for the prod iframe.
4. **`arcade/main.ts` — BOTH registries:**
   - the **card** entry (id/name/tag/summary/accent/glyph SVG) so it shows on the
     launcher (~line 66 block);
   - the **leaderboard** entry (id/name/accent/`boards`/`formatScore`) with boards
     `trade` + `clash` (~line 237 block).
5. **`cadence/index.html`** — relative script `src` so the game runs both standalone
   (`pnpm dev:cadence`) and inside the arcade iframe (matches the other games).
6. **`README.md`** — add CADENCE + its controls; **`CHANGELOG.md`** — new dated
   entry (documentation-discipline rule).

## Sequencing (strict — the gate is real)

1. **scaffold** — folder + all six registration points; empty game boots to a
   title screen.
2. **clock** — `clock.ts` + a single-lane metronome tap test. **Gate:** taps feel
   tight, judge windows are honest. If not, stop and fix here.
3. **calibrate** — offset flow feeding the judge; prove a deliberately mis-set
   offset is felt and correctable.
4. **music** — scale engine + layered synth on the clock; confirm hits are always
   consonant and layers unlock/drop with accuracy.
5. **modes** — TRADE first (it exercises phrase scheduling + handoff telegraphing,
   the hardest readability problem), then CLASH (adds the syncopation attack).
6. **juice** — beat-pulse, bloom, combo ribbon, help/title/calibrate polish.
7. **verify** — leaderboard boards, `pnpm build` green end-to-end, docs. User
   play-tests manually (per the no-browser-auto-verify rule).

## Open questions / risks

- **Latency is make-or-break.** Mitigated by building clock + calibration + tap test
  first as a hard gate.
- **Keyboard rollover** on cheap boards → keep simultaneous presses ≤ small; lanes
  ≤4/player; prefer sequential phrases.
- **Call-and-response readability at speed** → strong telegraphing of the "listen"
  bar (dim actor's lane, light the phrase) before the "repeat" bar; start slow,
  lengthen gradually.
- **Reuse vs. ECHO** → mine ECHO's pre-rewrite git history (before CHANGELOG
  2026-07-03) for any beat-scheduling ideas, but **expect to rewrite on the audio
  clock** — that was the piece ECHO was missing.
- **Zero runtime deps** preserved: pure Canvas 2D + WebAudio, fixed-timestep loop,
  pooled particles — same as the other nine.

## Questions for the user (non-blocking; sensible defaults chosen)

- **Starting key/scale** — default C minor pentatonic (forgiving). Prefer a
  different mood?
- **CLASH track length** — fixed ~90s track, or endless-until-someone-drops? Plan
  assumes a fixed track with accuracy score.
- **Four lanes or three per player** — plan assumes up to four; three is safer for
  rollover if we see dropped keys in testing.
