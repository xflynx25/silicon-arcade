---
name: CADENCE — rhythm call-and-response (reclaims the genre ECHO dropped)
overview: "A local 2-player rhythm game where you play to a generative beat instead of to physics. One new axis for the arcade: TIMING to audio. ECHO started as a rhythm game and pivoted away to survival, leaving the rhythm genre empty — CADENCE fills it fresh, built around call-and-response phrases the two players trade and stack into music they're co-authoring."
status: brainstorm
isProject: false
todos:
  - id: scaffold
    content: New cadence/ folder from template; dev:cadence script + workspace + README stub
    status: pending
  - id: clock
    content: "Core new system — a sample-accurate beat clock on WebAudio's currentTime (not rAF), a lookahead scheduler, and a note-lane hit judge (perfect/good/miss windows)"
    status: pending
  - id: synth
    content: "Generative music layer — a small chord/scale engine so every hit is musical, escalating layers that unlock as the players stay locked in"
    status: pending
  - id: modes
    content: Build Trade (call-and-response co-op) and Clash (competitive beat battle)
    status: pending
  - id: juice
    content: Beat-pulsing visuals, lane/hit VFX synced to the clock, combo bloom, title + How-to-Play, latency calibration screen
    status: pending
  - id: verify
    content: Latency calibration is honest; leaderboard board; changelog + README
    status: pending
---

# CADENCE — the rhythm game, done right

## Why this is new (vs. the existing 9)

Every current game rewards **spatial twitch** — aim, dodge, collide. CADENCE
rewards **temporal precision**: hitting on the beat. That's a completely different
skill and a different kind of fun (flow/groove, not reflex).

There's history here: **ECHO** was originally a co-op rhythm game and was rewritten
into a stealth-survival game (see CHANGELOG 2026-07-03). So the arcade *had* rhythm,
learned things, and abandoned it — the genre slot is empty and there are lessons
banked. CADENCE is a clean second attempt with a sharper hook: **call-and-response**.
Instead of both players hitting the same falling notes, one player plays a short
phrase and the other **answers it** on the next bar — you're trading licks and
building a track together.

## The core system: an audio-clocked scheduler (the real work)

The reason ECHO's rhythm attempt was fiddly is timing. CADENCE must be built on the
**WebAudio clock**, not the rAF loop:

- Drive judging off `audioCtx.currentTime` (sample-accurate). rAF only draws.
- A **lookahead scheduler** queues upcoming beats/notes ~100 ms early into WebAudio
  so audio never stutters regardless of frame rate (the classic "A Tale of Two
  Clocks" pattern).
- **Hit judging**: each incoming note has a target time; the player's keypress
  timestamp is compared → perfect / good / miss windows (± a few tens of ms).
- **Latency calibration screen** on first run (tap along to a metronome) storing an
  offset — non-negotiable for a rhythm game to feel fair on different setups.

This is a genuinely new engine primitive for the arcade (an audio clock + scheduler),
which is exactly what makes it worth building — but it's self-contained in one file.

## Generative, always-musical

The existing `audio.ts` synth is already oscillator-based. CADENCE adds a tiny
**scale/chord engine** so *every* on-beat hit maps to a consonant note in the current
key — you can't play a wrong note, only a wrong *time*. Sustained accuracy unlocks
extra instrument layers (bass, arp, pad), so a good run literally sounds fuller. That
"the music grows as you nail it" feedback is the whole emotional payoff.

## Modes (title picker `1`/`2`)

- **1 · TRADE (co-op call-and-response).** The game plays a short phrase on P1's lane
  (highlighted notes to hit); P1 performs it; on the next bar P2 must **echo the same
  phrase** on their lane. Bars alternate and lengthen; nailing the handoff keeps a
  shared **groove meter** climbing and adds music layers. Miss and the track thins
  out. Score = longest sustained groove.
- **2 · CLASH (competitive beat battle).** Notes stream to both lanes; each player
  scores their own accuracy, and a **hot streak** lets you fire a "syncopation" that
  briefly shifts *the rival's* incoming notes off-grid (a fair, rhythmic form of
  attack — you disrupt their timing, not their controls). Higher score after the
  track wins.

## Controls (rhythm-appropriate, minimal)

- Movement keys become **lane keys** — e.g. P1 `A S D` / `W` are up to four note
  lanes; P2 arrows likewise. `LShift`/`RShift` = the "accent/hold" for sustained
  notes. Fewer inputs than the action games, on purpose.
- Global: `[` / `]` adjust **BPM** (60–140) on the title screen (mirrors ECHO's old
  tempo control), `Enter` start, `R` restart, `H` help. Calibration reachable from title.

## Feel / juice

- The entire scene **pulses on the beat** (arena breathes, background grid flashes on
  downbeats) — cheap and hugely effective for rhythm feel.
- Perfect hits bloom; combos build a visible waveform/ribbon that thickens with the
  groove meter. Misses desaturate briefly.
- All VFX are scheduled against the audio clock too, so visuals sit *on* the music.

## Leaderboard

Metric = **longest groove** (Trade) or **accuracy score** (Clash). One board per
mode. Standard opt-in Blob pattern.

## Folder layout

```
cadence/
  index.html  package.json  tsconfig.json  vite.config.ts
  src/{main,input,loop,vec,particles,ui}.ts
  src/clock.ts       # NEW: WebAudio beat clock + lookahead scheduler + hit judge
  src/music.ts       # NEW: scale/chord engine + layered generative synth
  src/calibrate.ts   # NEW: latency calibration flow
  src/modes.ts       # trade / clash copy + config
  src/game.ts
```

## Open questions / risks

- Latency is the make-or-break. Build `clock.ts` + calibration + a single-lane
  metronome tap test *first*; if that doesn't feel tight, the rest doesn't matter.
- Keyboard rollover: cheap keyboards drop simultaneous keys. Keep required
  simultaneous presses low (this is why lanes stay ≤4 per player).
- Is call-and-response readable at speed? Telegraph the "listen" bar clearly
  (dim the acting player's lane, show the phrase lighting up) before the "repeat" bar.
- Reuse vs. ECHO: pull any salvageable beat-scheduling ideas from ECHO's git history
  before it was ripped out (CHANGELOG 2026-07-03), but expect to rewrite on the
  audio clock — that was the missing piece.
