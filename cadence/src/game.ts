import type { GlobalInput, InputManager, PlayerInput } from "./input";
import { LANE_COUNT } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import {
  BeatClock,
  BEATS_PER_BAR,
  STEPS_PER_BEAT,
  MAX_BPM,
  MIN_BPM,
  judgeOffset,
  type Judgement
} from "./clock";
import { MusicEngine } from "./music";
import { Calibrator, loadStoredOffset } from "./calibrate";
import { CONTROLS, MODE_HELP, MODE_LABEL, MODE_TITLE_LINE, type ModeId } from "./modes";
import { clamp } from "./vec";
import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "@arcade/leaderboard";

const LEADERBOARD_GAME = "cadence";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

export type GamePhase = "title" | "calibrate" | "playing" | "matchEnd";
export type Mode = ModeId;

const DEFAULT_BPM = 96;
const APPROACH_BEATS = 3;

// TRADE (co-op call-and-response)
const TRADE_START_PHRASE_LEN = 2;
const TRADE_MAX_PHRASE_LEN = 6;
const TRADE_GROWTH_EVERY = 3; // successful pairs before the phrase grows by one note
const TRADE_GROOVE_START = 60;
const TRADE_GROOVE_GAIN = 12;
const TRADE_GROOVE_LOSS = 35;

// CLASH (competitive beat battle)
const CLASH_DURATION = 90;
const CLASH_SKIP_CHANCE = 0.25;
const CLASH_STREAK_PER_CHARGE = 8;
const CLASH_MAX_SYNC_CHARGES = 2;
const CLASH_SYNC_DURATION = 3;
const CLASH_SYNC_OFFSET = 0.09;

type Note = {
  side: 1 | 2;
  lane: number;
  targetBeat: number;
  targetTime: number; // audioCtx-time judge target; may differ from timeOfBeat(targetBeat) under a sync attack
  degree: number;
  resolved: boolean;
  judgement: Judgement | "none" | null;
  resolvedAgeBeats: number;
  synced: boolean;
};

type PhraseNote = { lane: number; offsetBeats: number; degree: number };

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    global: GlobalInput,
    input: InputManager,
    audio: AudioSystem
  ) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const generatePhrase = (length: number): PhraseNote[] => {
  const notes: PhraseNote[] = [];
  let lastLane = -1;
  for (let i = 0; i < length; i += 1) {
    let lane = Math.floor(Math.random() * LANE_COUNT);
    if (lane === lastLane) {
      lane = (lane + 1) % LANE_COUNT;
    }
    lastLane = lane;
    notes.push({
      lane,
      offsetBeats: (i / length) * BEATS_PER_BAR,
      degree: Math.floor(Math.random() * 5)
    });
  }
  return notes;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let mode: Mode = "trade";
  let pendingBpm = DEFAULT_BPM;
  let shake = 0;

  const particles = new ParticleSystem();
  let clock: BeatClock | null = null;
  let music: MusicEngine | null = null;
  let calUnsubscribe: (() => void) | null = null;
  const calibrator = new Calibrator();
  let calibrationOffset = loadStoredOffset();

  let liveNotes: Note[] = [];
  let missFlash = 0;
  let perfectFlash = 0;
  const recentHits: { atBeat: number; judgement: Judgement }[] = [];

  // TRADE state
  let actingSide: 1 | 2 = 1;
  let barRole: "act" | "echo" = "act";
  let phraseLength = TRADE_START_PHRASE_LEN;
  let currentPhrase: PhraseNote[] = [];
  let barIndex = 0;
  let barHadMiss = false;
  let actBarPassed = false;
  let grooveMeter = TRADE_GROOVE_START;
  let pairsCompleted = 0;
  let bestTradeBars = 0;
  let tradeFailed = false;

  // CLASH state
  let clashTimeLeft = CLASH_DURATION;
  let p1Score = 0;
  let p2Score = 0;
  let p1ChargeProgress = 0;
  let p2ChargeProgress = 0;
  let p1SyncCharges = 0;
  let p2SyncCharges = 0;
  let p1UnderAttackUntil = -1;
  let p2UnderAttackUntil = -1;
  let prevAccentHeld1 = false;
  let prevAccentHeld2 = false;
  let nextSpawnBeat1 = 0;
  let nextSpawnBeat2 = 0;
  let clashWinner: 1 | 2 | null = null;

  // Leaderboard state
  let endHandled = false;
  let endScore = 0;
  let endBoardKey = "";
  let leaderboardActive = false;
  let nameEntry: NameEntry | null = null;
  let board: LeaderboardEntry[] = [];
  let submitState: SubmitState = "idle";
  let justSubmitted: { name: string; score: number } | null = null;

  const beginEndSequence = (boardKey: string, score: number): void => {
    endHandled = true;
    endScore = score;
    endBoardKey = boardKey;
    submitState = "idle";
    justSubmitted = null;
    nameEntry = null;
    leaderboardActive = false;
    board = [];
    getLeaderboard(LEADERBOARD_GAME, boardKey).then((state) => {
      if (phase !== "matchEnd" || endBoardKey !== boardKey) return;
      if (!state.enabled) return;
      leaderboardActive = true;
      board = state.entries;
      if (qualifies(state.entries, score)) {
        nameEntry = { active: true, chars: [] };
      }
    });
  };

  const updateNameEntry = (input: InputManager): void => {
    const ne = nameEntry;
    if (!ne) return;
    if (input.consumePress("Enter") || input.consumePress("NumpadEnter")) {
      if (ne.chars.length >= 1) confirmName();
      return;
    }
    if (input.consumePress("Backspace")) {
      ne.chars.pop();
      return;
    }
    if (ne.chars.length >= NAME_MAX) return;
    for (let c = 65; c <= 90; c += 1) {
      if (input.consumePress(`Key${String.fromCharCode(c)}`)) {
        ne.chars.push(String.fromCharCode(c));
        return;
      }
    }
    for (let d = 0; d <= 9; d += 1) {
      if (input.consumePress(`Digit${d}`) || input.consumePress(`Numpad${d}`)) {
        ne.chars.push(String(d));
        return;
      }
    }
  };

  const confirmName = (): void => {
    const ne = nameEntry;
    if (!ne) return;
    const name = ne.chars.join("");
    nameEntry = null;
    submitState = "submitting";
    justSubmitted = { name, score: endScore };
    const boardKey = endBoardKey;
    submitScore(LEADERBOARD_GAME, boardKey, name, endScore).then((res) => {
      if (endBoardKey !== boardKey) return;
      if (res) {
        board = res.entries;
        submitState = "done";
      } else {
        submitState = "error";
      }
    });
  };

  const formatBoard = (modeLabel: string): string => {
    const heading = `— CADENCE · ${modeLabel} —`;
    if (board.length === 0) {
      return `${heading}\n(no scores yet — be the first!)`;
    }
    const rows = board.slice(0, 10).map((e, i) => {
      const mine =
        justSubmitted !== null &&
        e.name === justSubmitted.name &&
        Math.abs(e.score - justSubmitted.score) < 0.05;
      const marker = mine ? "▶ " : "  ";
      const rank = String(i + 1).padStart(2, " ");
      const name = e.name.padEnd(NAME_MAX, " ");
      const scoreStr = String(Math.round(e.score)).padStart(7, " ");
      return `${marker}${rank}. ${name} ${scoreStr}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  };

  const resetLeaderboardState = (): void => {
    endHandled = false;
    leaderboardActive = false;
    nameEntry = null;
    board = [];
    submitState = "idle";
    justSubmitted = null;
  };

  const layerLevelForGroove = (groove: number): number => {
    if (groove >= 80) return 3;
    if (groove >= 55) return 2;
    if (groove >= 30) return 1;
    return 0;
  };

  const beginPhraseBar = (side: 1 | 2, role: "act" | "echo", phrase: PhraseNote[]): void => {
    if (!clock) return;
    actingSide = side;
    barRole = role;
    barHadMiss = false;
    const barStartBeat = barIndex * BEATS_PER_BAR;
    for (const pn of phrase) {
      const targetBeat = barStartBeat + pn.offsetBeats;
      liveNotes.push({
        side,
        lane: pn.lane,
        targetBeat,
        targetTime: clock.timeOfBeat(targetBeat),
        degree: pn.degree,
        resolved: false,
        judgement: null,
        resolvedAgeBeats: 0,
        synced: false
      });
    }
  };

  const beginTradeRun = (): void => {
    if (!clock) return;
    liveNotes = [];
    grooveMeter = TRADE_GROOVE_START;
    pairsCompleted = 0;
    phraseLength = TRADE_START_PHRASE_LEN;
    tradeFailed = false;
    barIndex = 0;
    currentPhrase = generatePhrase(phraseLength);
    beginPhraseBar(1, "act", currentPhrase);
    music?.setLayerLevel(layerLevelForGroove(grooveMeter));
  };

  const beginClashRun = (): void => {
    liveNotes = [];
    clashTimeLeft = CLASH_DURATION;
    p1Score = 0;
    p2Score = 0;
    p1ChargeProgress = 0;
    p2ChargeProgress = 0;
    p1SyncCharges = 0;
    p2SyncCharges = 0;
    p1UnderAttackUntil = -1;
    p2UnderAttackUntil = -1;
    nextSpawnBeat1 = 0;
    nextSpawnBeat2 = 1;
    clashWinner = null;
    music?.setLayerLevel(2);
  };

  const beginMode = (): void => {
    if (!clock) return;
    clock.stop();
    clock.setBpm(pendingBpm);
    clock.start();
    recentHits.length = 0;
    missFlash = 0;
    perfectFlash = 0;
    shake = 0;
    if (mode === "trade") {
      beginTradeRun();
    } else {
      beginClashRun();
    }
  };

  const resolveNote = (note: Note, judgement: Judgement, audio: AudioSystem): void => {
    note.resolved = true;
    note.judgement = judgement;
    recentHits.push({ atBeat: clock?.currentBeat ?? 0, judgement });
    if (recentHits.length > 24) recentHits.shift();
    if (judgement === "perfect") {
      perfectFlash = 0.18;
      particles.emit({ x: w * (note.side === 1 ? 0.3 : 0.7), y: h * 0.72 }, 16, note.side === 1 ? 320 : 190, 190);
    } else if (judgement === "good") {
      particles.emit({ x: w * (note.side === 1 ? 0.3 : 0.7), y: h * 0.72 }, 8, note.side === 1 ? 320 : 190, 140);
    } else {
      missFlash = 0.35;
      barHadMiss = true;
      shake = Math.max(shake, 5);
      music?.playMissTick(clock ? clock.audioCtx.currentTime : 0);
    }
    if (clock && music && judgement !== "miss") {
      music.playHitNote(note.degree, clock.audioCtx.currentTime, judgement === "perfect");
      audio.menuMove();
    }
  };

  const tryHitLane = (side: 1 | 2, lane: number, audio: AudioSystem): void => {
    if (!clock) return;
    const now = clock.audioCtx.currentTime;
    let best: Note | null = null;
    let bestDiff = Infinity;
    for (const n of liveNotes) {
      if (n.resolved || n.side !== side || n.lane !== lane) continue;
      const diff = Math.abs(now - calibrationOffset - n.targetTime);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = n;
      }
    }
    if (!best) return;
    const j = judgeOffset(now - calibrationOffset - best.targetTime);
    if (j === null) return; // not a plausible attempt on this note
    resolveNote(best, j, audio);
    if (mode === "clash") {
      applyClashScore(side, j);
    }
  };

  const applyClashScore = (side: 1 | 2, j: Judgement): void => {
    const points = j === "perfect" ? 3 : j === "good" ? 1 : 0;
    if (side === 1) {
      p1Score += points;
      if (j === "miss") {
        p1ChargeProgress = 0;
      } else {
        p1ChargeProgress += 1;
        if (p1ChargeProgress >= CLASH_STREAK_PER_CHARGE) {
          p1ChargeProgress = 0;
          p1SyncCharges = Math.min(CLASH_MAX_SYNC_CHARGES, p1SyncCharges + 1);
        }
      }
    } else {
      p2Score += points;
      if (j === "miss") {
        p2ChargeProgress = 0;
      } else {
        p2ChargeProgress += 1;
        if (p2ChargeProgress >= CLASH_STREAK_PER_CHARGE) {
          p2ChargeProgress = 0;
          p2SyncCharges = Math.min(CLASH_MAX_SYNC_CHARGES, p2SyncCharges + 1);
        }
      }
    }
  };

  const finishTradeBar = (audio: AudioSystem): void => {
    // Auto-resolve any note the player never attempted.
    for (const n of liveNotes) {
      if (!n.resolved && n.side === actingSide) {
        resolveNote(n, "miss", audio);
      }
    }
    if (barRole === "act") {
      actBarPassed = !barHadMiss;
      barIndex += 1;
      const echoSide: 1 | 2 = actingSide === 1 ? 2 : 1;
      beginPhraseBar(echoSide, "echo", currentPhrase);
    } else {
      const pairPassed = actBarPassed && !barHadMiss;
      if (pairPassed) {
        grooveMeter = Math.min(100, grooveMeter + TRADE_GROOVE_GAIN);
        pairsCompleted += 1;
        if (pairsCompleted % TRADE_GROWTH_EVERY === 0) {
          phraseLength = Math.min(TRADE_MAX_PHRASE_LEN, phraseLength + 1);
        }
      } else {
        grooveMeter = Math.max(0, grooveMeter - TRADE_GROOVE_LOSS);
        phraseLength = Math.max(TRADE_START_PHRASE_LEN, phraseLength - 1);
      }
      music?.setLayerLevel(layerLevelForGroove(grooveMeter));
      bestTradeBars = Math.max(bestTradeBars, pairsCompleted * 2);
      if (grooveMeter <= 0) {
        tradeFailed = true;
        shake = 16;
        phase = "matchEnd";
        if (!endHandled) beginEndSequence("trade", pairsCompleted * 2);
        return;
      }
      barIndex += 1;
      // The player who just echoed becomes the caller for the next pair —
      // this alternates who leads without an extra flip (actingSide is
      // already the echoer here, set by the beginPhraseBar(..., "echo", ...)
      // call that started this bar).
      currentPhrase = generatePhrase(phraseLength);
      beginPhraseBar(actingSide, "act", currentPhrase);
    }
  };

  const updateTrade = (dt: number, audio: AudioSystem): void => {
    if (!clock) return;
    const liveBar = Math.floor(clock.currentBeat / BEATS_PER_BAR);
    if (liveBar > barIndex && phase === "playing") {
      finishTradeBar(audio);
    }
    // Drop resolved notes shortly after resolution so hit/miss flashes are visible briefly.
    for (const n of liveNotes) {
      if (n.resolved) n.resolvedAgeBeats += dt;
    }
    liveNotes = liveNotes.filter((n) => !n.resolved || n.resolvedAgeBeats < 0.4);
  };

  const maybeSpawnClashNote = (side: 1 | 2): void => {
    if (!clock) return;
    const nextSpawnBeat = side === 1 ? nextSpawnBeat1 : nextSpawnBeat2;
    if (clock.currentBeat + APPROACH_BEATS < nextSpawnBeat) return;
    const underAttackUntil = side === 1 ? p1UnderAttackUntil : p2UnderAttackUntil;
    if (Math.random() >= CLASH_SKIP_CHANCE) {
      const lane = Math.floor(Math.random() * LANE_COUNT);
      const baseTime = clock.timeOfBeat(nextSpawnBeat);
      const now = clock.audioCtx.currentTime;
      const synced = now < underAttackUntil;
      const targetTime = synced ? baseTime + (Math.random() < 0.5 ? -1 : 1) * CLASH_SYNC_OFFSET : baseTime;
      liveNotes.push({
        side,
        lane,
        targetBeat: nextSpawnBeat,
        targetTime,
        degree: Math.floor(nextSpawnBeat) % 5,
        resolved: false,
        judgement: null,
        resolvedAgeBeats: 0,
        synced
      });
    }
    if (side === 1) {
      nextSpawnBeat1 += 1;
    } else {
      nextSpawnBeat2 += 1;
    }
  };

  const fireSyncopation = (side: 1 | 2, audio: AudioSystem): void => {
    if (!clock) return;
    const now = clock.audioCtx.currentTime;
    if (side === 1 && p1SyncCharges > 0) {
      p1SyncCharges -= 1;
      p2UnderAttackUntil = now + CLASH_SYNC_DURATION;
      audio.error();
    } else if (side === 2 && p2SyncCharges > 0) {
      p2SyncCharges -= 1;
      p1UnderAttackUntil = now + CLASH_SYNC_DURATION;
      audio.error();
    }
  };

  const updateClash = (dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem): void => {
    if (!clock) return;
    clashTimeLeft -= dt;

    if (p1.accentHeld && !prevAccentHeld1) fireSyncopation(1, audio);
    if (p2.accentHeld && !prevAccentHeld2) fireSyncopation(2, audio);
    prevAccentHeld1 = p1.accentHeld;
    prevAccentHeld2 = p2.accentHeld;

    maybeSpawnClashNote(1);
    maybeSpawnClashNote(2);

    const now = clock.audioCtx.currentTime;
    for (const n of liveNotes) {
      if (!n.resolved && now - calibrationOffset > n.targetTime + 0.15) {
        resolveNote(n, "miss", audio);
        applyClashScore(n.side, "miss");
      }
      if (n.resolved) n.resolvedAgeBeats += dt;
    }
    liveNotes = liveNotes.filter((n) => !n.resolved || n.resolvedAgeBeats < 0.4);

    if (clashTimeLeft <= 0) {
      clashTimeLeft = 0;
      clashWinner = p1Score > p2Score ? 1 : p2Score > p1Score ? 2 : null;
      phase = "matchEnd";
      const winningScore = Math.max(p1Score, p2Score);
      if (!endHandled) beginEndSequence("clash", winningScore);
    }
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
    },

    startRound(): void {
      phase = "playing";
      resetLeaderboardState();
      beginMode();
    },

    restartRound(): void {
      if (nameEntry?.active) return;
      if (phase === "calibrate") return;
      phase = "playing";
      resetLeaderboardState();
      beginMode();
    },

    update(
      dt: number,
      p1: PlayerInput,
      p2: PlayerInput,
      global: GlobalInput,
      input: InputManager,
      audio: AudioSystem
    ): void {
      if (!clock && audio.context) {
        clock = new BeatClock(audio.context, pendingBpm);
        music = new MusicEngine(audio.context);
        clock.subscribe(music.onStep);
      }

      particles.update(dt);
      shake = Math.max(0, shake - dt * 24);
      missFlash = Math.max(0, missFlash - dt);
      perfectFlash = Math.max(0, perfectFlash - dt);

      if (phase === "title") {
        if (input.consumePress("Digit1")) mode = "trade";
        else if (input.consumePress("Digit2")) mode = "clash";
        if (input.consumePress("BracketLeft")) pendingBpm = clamp(pendingBpm - 4, MIN_BPM, MAX_BPM);
        if (input.consumePress("BracketRight")) pendingBpm = clamp(pendingBpm + 4, MIN_BPM, MAX_BPM);
        if (global.calibratePressed && clock) {
          phase = "calibrate";
          clock.stop();
          clock.setBpm(100);
          clock.start();
          calibrator.begin(clock);
          calUnsubscribe = clock.subscribe((step, time) => {
            if (step % STEPS_PER_BEAT === 0 && music) {
              const strong = step % (STEPS_PER_BEAT * BEATS_PER_BAR) === 0;
              music.playClick(time, strong);
            }
          });
        }
        if (global.startPressed) {
          this.startRound();
        }
        input.endFrame();
        return;
      }

      if (phase === "calibrate") {
        if (input.anyTapPressed() && audio.context) {
          calibrator.registerTap(audio.context.currentTime);
        }
        if (calibrator.phase === "done") {
          calibrationOffset = calibrator.result;
          if (global.startPressed || global.calibratePressed) {
            calUnsubscribe?.();
            calUnsubscribe = null;
            clock?.stop();
            phase = "title";
          } else if (global.restartPressed) {
            clock?.stop();
            clock?.setBpm(100);
            clock?.start();
            if (clock) calibrator.begin(clock);
          }
        } else if (global.restartPressed) {
          calUnsubscribe?.();
          calUnsubscribe = null;
          clock?.stop();
          phase = "title";
        }
        input.endFrame();
        return;
      }

      if (phase === "matchEnd") {
        if (nameEntry?.active) {
          updateNameEntry(input);
        }
        if (global.restartPressed && !nameEntry?.active) {
          this.restartRound();
        }
        input.endFrame();
        return;
      }

      // phase === "playing"
      if (!clock) {
        input.endFrame();
        return;
      }

      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        if (p1.lanePressed[lane]) tryHitLane(1, lane, audio);
        if (p2.lanePressed[lane]) tryHitLane(2, lane, audio);
      }

      if (mode === "trade") {
        updateTrade(dt, audio);
      } else {
        updateClash(dt, p1, p2, audio);
      }

      if (global.restartPressed) {
        this.restartRound();
      }

      input.endFrame();
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) return;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      w = rw;
      h = rh;
      ctx.fillStyle = "#05030a";
      ctx.fillRect(0, 0, w, h);

      const beat = clock?.currentBeat ?? 0;
      const beatFrac = beat - Math.floor(beat);
      const pulse = clock?.isRunning ? Math.max(0, 1 - beatFrac * 3) : 0;
      const downbeat = clock?.isRunning ? Math.floor(beat) % BEATS_PER_BAR === 0 : false;

      // Whole-arena beat pulse — a soft radial wash that breathes with the beat.
      if (pulse > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.65);
        const alpha = pulse * (downbeat ? 0.09 : 0.045);
        glow.addColorStop(0, `rgba(255, 63, 164, ${alpha})`);
        glow.addColorStop(1, "rgba(255, 63, 164, 0)");
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      const hitLineY = h * 0.78;
      const laneAreaTop = h * 0.16;
      const approachDist = hitLineY - laneAreaTop;
      const approachSec = clock ? APPROACH_BEATS * clock.beatDuration : 1;

      const laneX = (side: 1 | 2, lane: number): number => {
        const half = w / 2;
        const margin = half * 0.16;
        const usable = half - margin * 2;
        const laneW = usable / LANE_COUNT;
        const base = side === 1 ? margin : half + margin;
        return base + laneW * (lane + 0.5);
      };

      const activeSide: 1 | 2 | null = phase === "playing" && mode === "trade" ? actingSide : null;

      // Grid flash on downbeats + lane columns.
      ctx.save();
      for (const side of [1, 2] as const) {
        const dim = mode === "trade" && activeSide !== null && side !== activeSide;
        for (let lane = 0; lane < LANE_COUNT; lane += 1) {
          const x = laneX(side, lane);
          ctx.strokeStyle = dim
            ? "rgba(255, 63, 164, 0.06)"
            : `rgba(255, 63, 164, ${0.12 + (downbeat ? pulse * 0.18 : 0)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, laneAreaTop);
          ctx.lineTo(x, hitLineY + 14);
          ctx.stroke();
        }
      }
      ctx.restore();

      // Hit line.
      ctx.save();
      ctx.strokeStyle = "rgba(255, 228, 246, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(w * 0.06, hitLineY);
      ctx.lineTo(w * 0.94, hitLineY);
      ctx.stroke();
      ctx.restore();

      // Falling notes.
      for (const n of liveNotes) {
        const dim = mode === "trade" && activeSide !== null && n.side !== activeSide;
        if (dim) continue;
        const now = clock?.audioCtx.currentTime ?? 0;
        const timeUntil = n.targetTime - now;
        const t = clamp(1 - timeUntil / approachSec, 0, 1.15);
        const x = laneX(n.side, n.lane);
        const y = laneAreaTop + approachDist * t;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        let color = n.side === 1 ? "56, 220, 255" : "255, 160, 90";
        if (n.synced) color = "255, 80, 220";
        let alpha = 0.85;
        if (n.resolved) {
          alpha = Math.max(0, 1 - n.resolvedAgeBeats / 0.4);
          if (n.judgement === "perfect") color = "255, 240, 180";
          else if (n.judgement === "miss") color = "120, 120, 130";
        }
        ctx.fillStyle = `rgba(${color}, ${alpha})`;
        ctx.shadowColor = `rgba(${color}, 0.8)`;
        ctx.shadowBlur = n.resolved ? 0 : 10;
        const size = 12;
        ctx.beginPath();
        ctx.roundRect(x - size / 2, y - size / 2, size, size, 3);
        ctx.fill();
        ctx.restore();
      }

      // Combo/groove ribbon — thickens with sustained accuracy.
      const comboFactor =
        mode === "trade" ? grooveMeter / 100 : Math.min(1, Math.max(p1ChargeProgress, p2ChargeProgress) / CLASH_STREAK_PER_CHARGE);
      const ribbonY = h * 0.92;
      const ribbonThickness = 3 + comboFactor * 18;
      ctx.save();
      ctx.strokeStyle = `rgba(255, 63, 164, ${0.35 + comboFactor * 0.4})`;
      ctx.lineWidth = ribbonThickness;
      ctx.lineCap = "round";
      ctx.beginPath();
      const n = recentHits.length;
      for (let i = 0; i < n; i += 1) {
        const hit = recentHits[i];
        const x = w * 0.1 + (w * 0.8 * i) / Math.max(1, n - 1);
        const amp = hit.judgement === "perfect" ? -8 : hit.judgement === "good" ? -3 : 6;
        if (i === 0) ctx.moveTo(x, ribbonY + amp);
        else ctx.lineTo(x, ribbonY + amp);
      }
      if (n === 0) {
        ctx.moveTo(w * 0.1, ribbonY);
        ctx.lineTo(w * 0.9, ribbonY);
      }
      ctx.stroke();
      ctx.restore();

      particles.render(ctx);

      // Miss desaturate flash.
      if (missFlash > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(20, 18, 26, ${(missFlash / 0.35) * 0.35})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      if (perfectFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `rgba(255, 240, 200, ${(perfectFlash / 0.18) * 0.08})`;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
    },

    getHud(): { left: string; center: string; right: string } {
      if (phase === "calibrate") {
        return {
          left: "CALIBRATE",
          center: `Tap any key on the beat · ${calibrator.tapsCollected}/${calibrator.tapsTarget}`,
          right: calibrator.phase === "done" ? `Offset ${(calibrator.result * 1000).toFixed(0)}ms` : ""
        };
      }
      if (mode === "trade") {
        return {
          left: `Groove ${Math.round(grooveMeter)}%`,
          center: phase === "playing" ? `TRADE · Bars ${pairsCompleted * 2} · ${Math.round(pendingBpm)} BPM` : "",
          right: `Best ${bestTradeBars}`
        };
      }
      return {
        left: `P1 ${p1Score}  ·  sync ${p1SyncCharges}`,
        center: phase === "playing" ? `CLASH · ${Math.ceil(clashTimeLeft)}s left` : "",
        right: `sync ${p2SyncCharges}  ·  ${p2Score} P2`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        const menu =
          "Choose a mode:\n" +
          `${MODE_TITLE_LINE.trade}\n` +
          `${MODE_TITLE_LINE.clash}\n\n` +
          `▶ selected: ${MODE_LABEL[mode]}  ·  BPM ${Math.round(pendingBpm)}\n\n` +
          CONTROLS;
        return {
          title: "CADENCE",
          body:
            menu +
            "\n\nEnter to start  ·  R to restart  ·  Hold H for help\n" +
            "C to calibrate latency" +
            (calibrationOffset !== 0 ? ` (current offset ${(calibrationOffset * 1000).toFixed(0)}ms)` : " (not calibrated yet)"),
          visible: true
        };
      }
      if (phase === "calibrate") {
        if (calibrator.phase === "done") {
          return {
            title: "CALIBRATED",
            body:
              `Offset: ${(calibrator.result * 1000).toFixed(0)}ms\n\n` +
              "Enter / C to return to title\nR to recalibrate",
            visible: true
          };
        }
        return {
          title: "CALIBRATE",
          body:
            `Tap ANY key in time with the click.\n\n` +
            `${calibrator.tapsCollected} / ${calibrator.tapsTarget} taps\n\n` +
            "R to cancel",
          visible: true
        };
      }
      if (phase === "matchEnd") {
        if (mode === "trade") {
          const header = `Groove broke after ${pairsCompleted * 2} bars\nBest ${bestTradeBars} bars`;
          const footer = "Press R to jam again";
          if (!leaderboardActive) {
            return { title: `${pairsCompleted * 2} BARS`, body: `${header}\n${footer}`, visible: true };
          }
          if (nameEntry?.active) {
            const typed = nameEntry.chars.join("");
            const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
            return {
              title: "NEW HIGH SCORE!",
              body: `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\nType A–Z / 0–9  ·  Backspace  ·  Enter to save`,
              visible: true
            };
          }
          const status =
            submitState === "submitting" ? "\nSaving…" : submitState === "error" ? "\n(couldn't reach leaderboard — score not saved)" : "";
          return {
            title: `${pairsCompleted * 2} BARS`,
            body: `${header}${status}\n\n${formatBoard(MODE_LABEL.trade)}\n\n${footer}`,
            visible: true
          };
        }
        const winnerLabel = clashWinner ? `PLAYER ${clashWinner} WINS` : "DRAW";
        const header = `P1 ${p1Score}  —  P2 ${p2Score}`;
        const footer = "Press R for a rematch";
        if (!leaderboardActive) {
          return { title: winnerLabel, body: `${header}\n${footer}`, visible: true };
        }
        if (nameEntry?.active) {
          const typed = nameEntry.chars.join("");
          const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
          return {
            title: "NEW HIGH SCORE!",
            body: `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\nType A–Z / 0–9  ·  Backspace  ·  Enter to save`,
            visible: true
          };
        }
        const status =
          submitState === "submitting" ? "\nSaving…" : submitState === "error" ? "\n(couldn't reach leaderboard — score not saved)" : "";
        return {
          title: winnerLabel,
          body: `${header}${status}\n\n${formatBoard(MODE_LABEL.clash)}\n\n${footer}`,
          visible: true
        };
      }
      if (helpHeld) {
        return {
          title: `HOW TO PLAY · ${MODE_LABEL[mode]}`,
          body: MODE_HELP[mode] + "\n\n" + CONTROLS + "\n\nRelease H to resume",
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
