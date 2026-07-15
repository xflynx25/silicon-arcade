import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { CONTROLS, MODE_HELP, MODE_LABEL, MODE_TITLE_LINE, type ModeId } from "./modes";
import { add, clamp, dist, len, normalize, scale, sub, vec, type Vec } from "./vec";
import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "@arcade/leaderboard";

const LEADERBOARD_GAME = "nova";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";
export type Mode = ModeId;

const SHIP_R = 13;
const WIN_ROUNDS = 3; // duel: best of 5

const THRUST_ACC = 440;
const DRAG = 0.9992; // very light — orbits should persist; gravity does the pulling
const MAX_SPEED = 1500;

const FLARE_CHARGE_RATE = 2.5;
const FLARE_MIN = 320;
const FLARE_SPAN = 560;

const SHIELD_TIME = 0.32;
const SHIELD_CD = 0.85;
const PERFECT_PARRY_WINDOW = 0.12;
const STAGGER_TIME = 0.4;
const FLARE_STRIKE_WINDOW = 0.15;

// A ram only kills when the aggressor has clearly slingshotted up to speed.
const KILL_SPEED = 280;
const KILL_RATIO = 1.15;

const DUEL_CORONA_SCALE = 0.88;
const DUEL_VOID_SCALE = 1.02;

const GRAVITY_STEP = 0.15;
const GRAVITY_MIN = 0.4;
const GRAVITY_MAX = 2.5;

// Flares (co-op survival)
const BOLT_R = 9;
const WAVE_EVERY = 12; // seconds per difficulty step
const CORONA_CREEP_PER_WAVE = 0.025;
const CORONA_CREEP_MAX = 1.3;
const FLARES_LIVES = 3;
const BOLT_TELEGRAPH = 0.4;
const HOMING_WAVE_MIN = 2;

// Rings (co-op collection)
const RUN_TIME = 60;
const RING_R = 26;
const RING_TARGET = 3;
const RING_LIFE = 9;
const RING_LIFE_RISK = 4;
const GOLDEN_CHANCE = 0.18;
const LINKED_GOLD_CHANCE = 0.2;
const LINKED_GOLD_WINDOW = 4;
const COMBO_WINDOW = 3;
const RISK_RING_CHANCE = 0.12;
const RISK_RING_VALUE = 5;
const MAGNET_RANGE = 120;
const MAGNET_PULL = 90;

type Comet = {
  pos: Vec;
  vel: Vec;
  charge: number;
  shield: number;
  shieldCd: number;
  hue: number;
  dashDir: Vec;
  trail: Vec[];
  flareStrikeWindow: number;
  stagger: number;
};

type Bolt = {
  pos: Vec;
  vel: Vec;
  homing: boolean;
};

type Ring = {
  pos: Vec;
  golden: boolean;
  life: number;
  pulse: number;
  risk: boolean;
  value: number;
  linkId: number | null;
  linkHalf: 1 | 2 | null;
};

type ActiveLink = {
  timer: number;
  halves: Set<1 | 2>;
};

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    input: InputManager,
    audio: AudioSystem
  ) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const formatTime = (t: number): string => {
  const total = Math.max(0, Math.floor(t));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let mode: Mode = "duel";
  let cx = w * 0.5;
  let cy = h * 0.5;

  // The three radii that define the ring of play, derived from screen size.
  let baseR = Math.min(w, h) * 0.5;
  let baseCoronaR = baseR * 0.14;
  let baseVoidR = baseR * 0.94;
  let coronaR = baseCoronaR; // inside this = burn up
  let voidR = baseVoidR; // outside this = lost to the void
  let orbitR = baseR * 0.52; // spawn orbit
  const orbitSpeed = 250;
  let gm = orbitSpeed * orbitSpeed * orbitR; // GM so orbitR is a circular orbit at orbitSpeed

  let gravityScale = 1;
  let starPulse = 0;
  let roundTimer = 0;
  let shake = 0;

  // Duel state
  let roundCount = 0;
  let winsP1 = 0;
  let winsP2 = 0;
  let lastRoundWinner: 1 | 2 | null = null;
  let lastCause = "";
  let matchWinner: 1 | 2 | null = null;

  // Flares state
  const bolts: Bolt[] = [];
  let survivalTime = 0;
  let bestFlares = 0;
  let flareTimer = 0;
  let waveIndex = 0;
  let sharedLives = FLARES_LIVES;
  let starTelegraph = 0;
  let pendingBoltPattern: number | null = null;
  let nextLinkId = 1;

  // Rings state
  const rings: Ring[] = [];
  const activeLinks = new Map<number, ActiveLink>();
  let runTime = RUN_TIME;
  let score = 0;
  let bestRings = 0;
  let combo = 0;
  let comboTimer = 0;

  // Leaderboard state (flares / rings end-of-run)
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
      if (qualifies(state.entries, endScore)) {
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
    const heading = `— NOVA · ${modeLabel} —`;
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
      const scoreStr =
        endBoardKey === "flares"
          ? `${e.score.toFixed(1)}s`.padStart(7, " ")
          : String(Math.round(e.score)).padStart(7, " ");
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

  const particles = new ParticleSystem();

  const comet1: Comet = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    shield: 0,
    shieldCd: 0,
    hue: 190,
    dashDir: vec(0, -1),
    trail: [],
    flareStrikeWindow: 0,
    stagger: 0
  };
  const comet2: Comet = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    shield: 0,
    shieldCd: 0,
    hue: 25,
    dashDir: vec(0, 1),
    trail: [],
    flareStrikeWindow: 0,
    stagger: 0
  };

  const computeGeometry = (): void => {
    cx = w * 0.5;
    cy = h * 0.5;
    baseR = Math.min(w, h) * 0.5;
    baseCoronaR = baseR * 0.14;
    baseVoidR = baseR * 0.94;
    orbitR = baseR * 0.52;
    gm = orbitSpeed * orbitSpeed * orbitR;
    applyModeBoundaries();
  };

  const applyModeBoundaries = (): void => {
    if (mode === "duel") {
      coronaR = baseCoronaR * DUEL_CORONA_SCALE;
      voidR = baseVoidR * DUEL_VOID_SCALE;
    } else if (mode === "flares") {
      const creep = Math.min(CORONA_CREEP_MAX, 1 + waveIndex * CORONA_CREEP_PER_WAVE);
      coronaR = baseCoronaR * creep;
      voidR = baseVoidR;
    } else {
      coronaR = baseCoronaR;
      voidR = baseVoidR;
    }
  };

  const resetComets = (): void => {
    // Opposite sides of the star, both moving counter-clockwise so they share a
    // period and stay across from each other until a player breaks the symmetry.
    comet1.pos = vec(cx - orbitR, cy);
    comet1.vel = vec(0, -orbitSpeed);
    comet1.dashDir = vec(0, -1);
    comet2.pos = vec(cx + orbitR, cy);
    comet2.vel = vec(0, orbitSpeed);
    comet2.dashDir = vec(0, 1);
    for (const c of [comet1, comet2]) {
      c.charge = 0;
      c.shield = 0;
      c.shieldCd = 0;
      c.trail = [];
      c.flareStrikeWindow = 0;
      c.stagger = 0;
    }
  };

  const respawnComet = (c: Comet, player: 1 | 2): void => {
    if (player === 1) {
      c.pos = vec(cx - orbitR, cy);
      c.vel = vec(0, -orbitSpeed);
      c.dashDir = vec(0, -1);
    } else {
      c.pos = vec(cx + orbitR, cy);
      c.vel = vec(0, orbitSpeed);
      c.dashDir = vec(0, 1);
    }
    c.charge = 0;
    c.shield = 0;
    c.shieldCd = 0.5;
    c.trail = [];
    c.flareStrikeWindow = 0;
    c.stagger = 0;
  };

  const resetArena = (): void => {
    particles.clear();
    starPulse = 0;
    bolts.length = 0;
    rings.length = 0;
  };

  const spawnRingAt = (angle: number, r: number, opts: Partial<Ring>): void => {
    rings.push({
      pos: vec(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r),
      golden: false,
      life: RING_LIFE,
      pulse: Math.random() * Math.PI * 2,
      risk: false,
      value: 1,
      linkId: null,
      linkHalf: null,
      ...opts
    });
  };

  const spawnRing = (): void => {
    if (Math.random() < RISK_RING_CHANCE) {
      const angle = Math.random() * Math.PI * 2;
      const r = coronaR + baseR * 0.06 + Math.random() * baseR * 0.04;
      spawnRingAt(angle, r, { risk: true, value: RISK_RING_VALUE, life: RING_LIFE_RISK, golden: true });
      return;
    }

    const angle = Math.random() * Math.PI * 2;
    const rMin = coronaR + baseR * 0.14;
    const rMax = voidR - baseR * 0.1;
    const r = rMin + Math.random() * (rMax - rMin);
    const golden = Math.random() < GOLDEN_CHANCE;

    if (golden && Math.random() < LINKED_GOLD_CHANCE) {
      const linkId = nextLinkId;
      nextLinkId += 1;
      const halfAngle = angle;
      const oppAngle = angle + Math.PI;
      const linkR = rMin + Math.random() * (rMax - rMin);
      spawnRingAt(halfAngle, linkR, {
        golden: true,
        value: 1,
        linkId,
        linkHalf: 1
      });
      spawnRingAt(oppAngle, linkR, {
        golden: true,
        value: 1,
        linkId,
        linkHalf: 2
      });
      activeLinks.set(linkId, { timer: LINKED_GOLD_WINDOW, halves: new Set() });
      return;
    }

    spawnRingAt(angle, r, {
      golden,
      value: golden ? 3 : 1
    });
  };

  const pushBolt = (pos: Vec, vel: Vec, homing: boolean): void => {
    bolts.push({ pos, vel, homing });
  };

  const nearestCometTo = (pos: Vec): Comet => {
    return dist(pos, comet1.pos) <= dist(pos, comet2.pos) ? comet1 : comet2;
  };

  const spawnBurstBolts = (): void => {
    const count = 1 + Math.floor(waveIndex / 3);
    const speed = 150 + waveIndex * 22;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const dir = vec(Math.cos(angle), Math.sin(angle));
      pushBolt(add(vec(cx, cy), scale(dir, coronaR + 4)), scale(dir, speed), false);
    }
    if (waveIndex >= HOMING_WAVE_MIN) {
      const target = nearestCometTo(vec(cx, cy));
      const toTarget = normalize(sub(target.pos, vec(cx, cy)));
      pushBolt(add(vec(cx, cy), scale(toTarget, coronaR + 4)), scale(toTarget, 95 + waveIndex * 8), true);
    }
  };

  const spawnSpiralBolts = (): void => {
    const count = 2 + Math.floor(waveIndex / 4);
    const speed = 140 + waveIndex * 20;
    const baseAngle = (waveIndex * 0.9) % (Math.PI * 2);
    for (let i = 0; i < count; i += 1) {
      const angle = baseAngle + (i * Math.PI * 2) / count;
      const dir = vec(Math.cos(angle), Math.sin(angle));
      pushBolt(add(vec(cx, cy), scale(dir, coronaR + 4)), scale(dir, speed), false);
    }
  };

  const spawnCrossfireBolts = (): void => {
    const speed = 165 + waveIndex * 24;
    for (const c of [comet1, comet2]) {
      const dir = normalize(sub(c.pos, vec(cx, cy)));
      pushBolt(add(vec(cx, cy), scale(dir, coronaR + 4)), scale(dir, speed), false);
    }
    if (waveIndex >= HOMING_WAVE_MIN) {
      const target = nearestCometTo(vec(cx, cy));
      const toTarget = normalize(sub(target.pos, vec(cx, cy)));
      pushBolt(add(vec(cx, cy), scale(toTarget, coronaR + 4)), scale(toTarget, 88 + waveIndex * 6), true);
    }
  };

  const spawnBolts = (): void => {
    const pattern = waveIndex % 3;
    if (pattern === 0) {
      spawnBurstBolts();
    } else if (pattern === 1) {
      spawnSpiralBolts();
    } else {
      spawnCrossfireBolts();
    }
  };

  const queueBoltSpawn = (): void => {
    const pattern = waveIndex % 3;
    if (pattern === 2 || waveIndex >= HOMING_WAVE_MIN) {
      pendingBoltPattern = pattern;
      starTelegraph = BOLT_TELEGRAPH;
      flareTimer = BOLT_TELEGRAPH;
    } else {
      spawnBolts();
    }
  };

  const applyStagger = (c: Comet): void => {
    c.stagger = STAGGER_TIME;
    c.charge = 0;
    c.flareStrikeWindow = 0;
  };

  const isPerfectParry = (c: Comet): boolean => {
    return c.shield > SHIELD_TIME - PERFECT_PARRY_WINDOW;
  };

  const updateComet = (
    c: Comet,
    input: PlayerInput,
    primaryReleased: boolean,
    dt: number,
    audio: AudioSystem
  ): void => {
    // Gravity toward the star — softened near the core so it doesn't blow up.
    const toStar = sub(vec(cx, cy), c.pos);
    const r = Math.max(len(toStar), coronaR * 0.8);
    const g = (gm * gravityScale) / (r * r);
    const gDir = normalize(toStar);
    c.vel = add(c.vel, scale(gDir, g * dt));

    // Player thrust.
    const thrust = normalize(vec(input.x, input.y));
    c.vel.x += thrust.x * THRUST_ACC * dt;
    c.vel.y += thrust.y * THRUST_ACC * dt;
    if (len(thrust) > 0.1) {
      c.dashDir = thrust;
    }

    c.flareStrikeWindow = Math.max(0, c.flareStrikeWindow - dt);
    c.stagger = Math.max(0, c.stagger - dt);

    // Flare: charge while primary held, release to lunge along the aim.
    if (c.stagger <= 0 && input.primary) {
      c.charge = clamp(c.charge + FLARE_CHARGE_RATE * dt, 0, 1);
    } else if (primaryReleased && c.charge > 0.05 && c.stagger <= 0) {
      const power = FLARE_MIN + c.charge * FLARE_SPAN;
      c.vel = add(c.vel, scale(c.dashDir, power));
      c.charge = 0;
      c.flareStrikeWindow = FLARE_STRIKE_WINDOW;
      audio.flare();
      particles.emit(c.pos, 10, c.hue, 160);
    } else if (!input.primary) {
      c.charge = Math.max(0, c.charge - 4 * dt);
    }

    // Shield: timed parry with a cooldown.
    if (input.secondary && c.shield <= 0 && c.shieldCd <= 0) {
      c.shield = SHIELD_TIME;
      c.shieldCd = SHIELD_CD;
      audio.shield();
    }
    c.shield = Math.max(0, c.shield - dt);
    c.shieldCd = Math.max(0, c.shieldCd - dt);

    // Light drag + speed cap keep the sim stable without killing orbits.
    c.vel.x *= Math.pow(DRAG, dt * 120);
    c.vel.y *= Math.pow(DRAG, dt * 120);
    const speed = len(c.vel);
    if (speed > MAX_SPEED) {
      c.vel = scale(c.vel, MAX_SPEED / speed);
    }
  };

  // Elastic bounce between the comets. When `lethal`, returns the loser (1|2) if
  // the exchange was a kill, else null. Co-op modes pass lethal=false (just bounce).
  const resolveCollision = (audio: AudioSystem, lethal: boolean): 1 | 2 | null => {
    const delta = sub(comet2.pos, comet1.pos);
    const d = len(delta);
    const minDist = SHIP_R * 2;
    if (d >= minDist || d < 0.001) {
      return null;
    }

    const n = normalize(delta);
    const overlap = minDist - d;
    comet1.pos = sub(comet1.pos, scale(n, overlap * 0.5));
    comet2.pos = add(comet2.pos, scale(n, overlap * 0.5));

    const s1 = len(comet1.vel);
    const s2 = len(comet2.vel);

    const relVel = sub(comet2.vel, comet1.vel);
    const velAlongNormal = relVel.x * n.x + relVel.y * n.y;
    if (velAlongNormal < 0) {
      const restitution = comet1.shield > 0 || comet2.shield > 0 ? 1.9 : 1.05;
      const impulse = (-(1 + restitution) * velAlongNormal) / 2;
      comet1.vel = sub(comet1.vel, scale(n, impulse));
      comet2.vel = add(comet2.vel, scale(n, impulse));
      shake = Math.max(shake, Math.min(Math.abs(impulse) * 0.06, 18));
    }

    const mid = vec((comet1.pos.x + comet2.pos.x) * 0.5, (comet1.pos.y + comet2.pos.y) * 0.5);

    if (!lethal) {
      audio.ram();
      particles.emit(mid, 8, 200, 150);
      return null;
    }

    // A shield reflects the ram — the shielded comet always wins the exchange.
    if (comet1.shield > 0 && comet2.shield <= 0) {
      if (isPerfectParry(comet1)) {
        applyStagger(comet2);
      }
      particles.emit(mid, 24, comet2.hue, 220);
      return 2;
    }
    if (comet2.shield > 0 && comet1.shield <= 0) {
      if (isPerfectParry(comet2)) {
        applyStagger(comet1);
      }
      particles.emit(mid, 24, comet1.hue, 220);
      return 1;
    }
    if (comet1.shield > 0 && comet2.shield > 0) {
      audio.ram();
      particles.emit(mid, 12, 200, 160);
      return null;
    }

    // No shields: the clearly faster comet shatters the slower one.
    const fast = Math.max(s1, s2);
    const slow = Math.min(s1, s2);
    if (fast >= KILL_SPEED && fast >= slow * KILL_RATIO) {
      const loser: 1 | 2 = s1 < s2 ? 1 : 2;
      particles.emit(mid, 24, loser === 1 ? comet1.hue : comet2.hue, 220);
      return loser;
    }

    audio.ram();
    particles.emit(mid, 10, 200, 150);
    return null;
  };

  // Keep a comet inside the ring of play without killing it (co-op modes).
  const softBoundary = (c: Comet): boolean => {
    const toStar = sub(vec(cx, cy), c.pos);
    const d = len(toStar);
    const inward = normalize(toStar);
    const inner = coronaR + SHIP_R;
    const outer = voidR - SHIP_R;
    let bounced = false;
    if (d < inner) {
      c.pos = sub(vec(cx, cy), scale(inward, inner));
      const vn = c.vel.x * inward.x + c.vel.y * inward.y;
      c.vel = sub(c.vel, scale(inward, 2 * vn));
      shake = Math.max(shake, 4);
      bounced = true;
    } else if (d > outer) {
      c.pos = sub(vec(cx, cy), scale(inward, outer));
      const vn = c.vel.x * inward.x + c.vel.y * inward.y;
      c.vel = sub(c.vel, scale(inward, 2 * vn));
      bounced = true;
    }
    return bounced;
  };

  const coronaDanger = (c: Comet): number => {
    const d = dist(c.pos, vec(cx, cy));
    return clamp(1 - (d - coronaR) / (baseR * 0.22), 0, 1);
  };

  const voidDanger = (c: Comet): number => {
    const d = dist(c.pos, vec(cx, cy));
    return clamp((d - voidR * 0.72) / (voidR * 0.28), 0, 1);
  };

  const awardRound = (
    winner: 1 | 2,
    cause: string,
    deadPos: Vec,
    deadHue: number,
    audio: AudioSystem
  ): void => {
    lastRoundWinner = winner;
    lastCause = cause;
    shake = 16;
    particles.emit(deadPos, 54, deadHue, 260);
    if (winner === 1) {
      winsP1 += 1;
    } else {
      winsP2 += 1;
    }
    matchWinner = winsP1 >= WIN_ROUNDS ? 1 : winsP2 >= WIN_ROUNDS ? 2 : null;
    phase = matchWinner !== null ? "matchEnd" : "roundEnd";
    roundTimer = 1.6;
    audio.shatter();
  };

  // Co-op run failed — record the run and show the end card.
  const endCoopRun = (deadPos: Vec, deadHue: number, cause: string, audio: AudioSystem): void => {
    lastCause = cause;
    shake = 16;
    particles.emit(deadPos, 54, deadHue, 260);
    bestFlares = Math.max(bestFlares, survivalTime);
    phase = "matchEnd";
    roundTimer = 0;
    audio.shatter();
    if (!endHandled) beginEndSequence("flares", survivalTime);
  };

  const damageCoopComet = (
    c: Comet,
    deadPos: Vec,
    deadHue: number,
    cause: string,
    audio: AudioSystem
  ): void => {
    sharedLives -= 1;
    shake = 12;
    particles.emit(deadPos, 36, deadHue, 200);
    audio.shatter();
    if (sharedLives <= 0) {
      endCoopRun(deadPos, deadHue, cause, audio);
      return;
    }
    const player: 1 | 2 = c === comet1 ? 1 : 2;
    respawnComet(c, player);
    lastCause = `${cause} · ${sharedLives} lives left`;
  };

  const beginMode = (): void => {
    resetArena();
    resetComets();
    winsP1 = 0;
    winsP2 = 0;
    matchWinner = null;
    roundCount = 1;
    lastRoundWinner = null;
    lastCause = "";
    survivalTime = 0;
    waveIndex = 0;
    sharedLives = FLARES_LIVES;
    starTelegraph = 0;
    pendingBoltPattern = null;
    flareTimer = mode === "flares" ? 2 : 0;
    runTime = RUN_TIME;
    score = 0;
    combo = 0;
    comboTimer = 0;
    activeLinks.clear();
    nextLinkId = 1;
    applyModeBoundaries();
  };

  const checkFlareStrikes = (audio: AudioSystem): boolean => {
    const pairs: [Comet, Comet, 1 | 2][] = [
      [comet1, comet2, 1],
      [comet2, comet1, 2]
    ];
    for (const [attacker, defender, attackerId] of pairs) {
      if (attacker.flareStrikeWindow <= 0) {
        continue;
      }
      if (dist(attacker.pos, defender.pos) > SHIP_R * 2.5) {
        continue;
      }
      if (defender.shield > 0) {
        if (isPerfectParry(defender)) {
          applyStagger(attacker);
        }
        attacker.flareStrikeWindow = 0;
        particles.emit(defender.pos, 14, defender.hue, 180);
        audio.shield();
        continue;
      }
      if (attacker.shield > 0 && defender.shield > 0) {
        continue;
      }
      const winner: 1 | 2 = attackerId;
      const loser: 1 | 2 = attackerId === 1 ? 2 : 1;
      awardRound(winner, "Flare strike", loser === 1 ? comet1.pos : comet2.pos, loser === 1 ? comet1.hue : comet2.hue, audio);
      return true;
    }
    return false;
  };

  const updateDuel = (audio: AudioSystem): void => {
    if (checkFlareStrikes(audio)) {
      return;
    }

    const collisionLoser = resolveCollision(audio, true);
    if (collisionLoser !== null) {
      const winner: 1 | 2 = collisionLoser === 1 ? 2 : 1;
      const dead = collisionLoser === 1 ? comet1 : comet2;
      awardRound(winner, "Shattered on impact", dead.pos, dead.hue, audio);
      return;
    }

    // Boundary deaths: corona (too close) and the void (too far).
    const d1 = dist(comet1.pos, vec(cx, cy));
    const d2 = dist(comet2.pos, vec(cx, cy));
    const burn1 = d1 < coronaR;
    const burn2 = d2 < coronaR;
    const void1 = d1 > voidR;
    const void2 = d2 > voidR;
    const out1 = burn1 || void1;
    const out2 = burn2 || void2;

    if (out1 || out2) {
      let loser: 1 | 2;
      if (out1 && out2) {
        const ex1 = burn1 ? coronaR - d1 : d1 - voidR;
        const ex2 = burn2 ? coronaR - d2 : d2 - voidR;
        loser = ex1 >= ex2 ? 1 : 2;
      } else {
        loser = out1 ? 1 : 2;
      }
      const winner: 1 | 2 = loser === 1 ? 2 : 1;
      const burned = loser === 1 ? burn1 : burn2;
      const dead = loser === 1 ? comet1 : comet2;
      if (burned) {
        audio.burn();
      }
      awardRound(winner, burned ? "Burned in the star" : "Lost to the void", dead.pos, dead.hue, audio);
    }
  };

  const updateFlares = (dt: number, audio: AudioSystem): void => {
    survivalTime += dt;
    const nextWave = Math.floor(survivalTime / WAVE_EVERY);
    if (nextWave !== waveIndex) {
      waveIndex = nextWave;
      applyModeBoundaries();
    }

    starTelegraph = Math.max(0, starTelegraph - dt);

    resolveCollision(audio, false);

    flareTimer -= dt;
    if (flareTimer <= 0) {
      if (pendingBoltPattern !== null) {
        spawnBolts();
        pendingBoltPattern = null;
        flareTimer = Math.max(0.55, 1.9 - waveIndex * 0.15);
      } else {
        queueBoltSpawn();
        if (pendingBoltPattern === null) {
          flareTimer = Math.max(0.55, 1.9 - waveIndex * 0.15);
        }
      }
    }

    for (let i = bolts.length - 1; i >= 0; i -= 1) {
      const b = bolts[i];
      if (b.homing) {
        const target = nearestCometTo(b.pos);
        const steer = normalize(sub(target.pos, b.pos));
        const speed = len(b.vel);
        const blended = normalize(add(scale(normalize(b.vel), 0.65), scale(steer, 0.35)));
        b.vel = scale(blended, speed);
      }
      b.pos = add(b.pos, scale(b.vel, dt));
      const d = dist(b.pos, vec(cx, cy));
      if (d > voidR + 40) {
        bolts.splice(i, 1);
        continue;
      }
      let consumed = false;
      for (const c of [comet1, comet2]) {
        if (dist(b.pos, c.pos) < SHIP_R + BOLT_R) {
          if (c.shield > 0) {
            particles.emit(b.pos, 12, 45, 180);
            audio.shield();
            consumed = true;
          } else {
            damageCoopComet(
              c,
              c.pos,
              c.hue,
              `Struck by a flare · lasted ${formatTime(survivalTime)}`,
              audio
            );
            if (phase !== "playing") {
              return;
            }
          }
        }
      }
      if (consumed) {
        bolts.splice(i, 1);
      }
    }

    // Corona / void are still lethal in survival.
    for (const c of [comet1, comet2]) {
      const d = dist(c.pos, vec(cx, cy));
      if (d < coronaR) {
        audio.burn();
        damageCoopComet(c, c.pos, c.hue, `Burned in the star · lasted ${formatTime(survivalTime)}`, audio);
        if (phase !== "playing") {
          return;
        }
      } else if (d > voidR) {
        damageCoopComet(c, c.pos, c.hue, `Lost to the void · lasted ${formatTime(survivalTime)}`, audio);
        if (phase !== "playing") {
          return;
        }
      }
    }
  };

  const collectRing = (ring: Ring, audio: AudioSystem): number => {
    let gain = ring.value;
    if (ring.linkId !== null && ring.linkHalf !== null) {
      const link = activeLinks.get(ring.linkId);
      if (link !== undefined) {
        link.halves.add(ring.linkHalf);
        link.timer = LINKED_GOLD_WINDOW;
        if (link.halves.has(1) && link.halves.has(2)) {
          gain = 6;
          activeLinks.delete(ring.linkId);
        } else {
          gain = 0;
        }
      }
    }

    if (gain <= 0) {
      return 0;
    }

    if (comboTimer > 0) {
      combo += 1;
    } else {
      combo = 1;
    }
    comboTimer = COMBO_WINDOW;
    return gain * combo;
  };

  const applyRingMagnet = (c: Comet, dt: number): void => {
    if (c.shield <= 0) {
      return;
    }
    let nearest: Ring | null = null;
    let nearestDist = MAGNET_RANGE;
    for (const ring of rings) {
      const d = dist(ring.pos, c.pos);
      if (d < nearestDist) {
        nearest = ring;
        nearestDist = d;
      }
    }
    if (nearest === null) {
      return;
    }
    const pull = normalize(sub(c.pos, nearest.pos));
    nearest.pos = add(nearest.pos, scale(pull, MAGNET_PULL * dt));
  };

  const updateRings = (dt: number, audio: AudioSystem): void => {
    runTime -= dt;
    comboTimer = Math.max(0, comboTimer - dt);

    resolveCollision(audio, false);
    if (softBoundary(comet1) || softBoundary(comet2)) {
      combo = 0;
      comboTimer = 0;
    }

    applyRingMagnet(comet1, dt);
    applyRingMagnet(comet2, dt);

    for (const [linkId, link] of activeLinks) {
      link.timer -= dt;
      if (link.timer <= 0) {
        activeLinks.delete(linkId);
      }
    }

    while (rings.length < RING_TARGET) {
      spawnRing();
    }

    for (let i = rings.length - 1; i >= 0; i -= 1) {
      const ring = rings[i];
      ring.life -= dt;
      ring.pulse += dt * 3;
      if (ring.life <= 0) {
        if (ring.linkId !== null) {
          activeLinks.delete(ring.linkId);
        }
        rings.splice(i, 1);
        continue;
      }
      const hit1 = dist(ring.pos, comet1.pos) < RING_R;
      const hit2 = dist(ring.pos, comet2.pos) < RING_R;
      if (hit1 || hit2) {
        if (ring.linkHalf !== null && hit1 && ring.linkHalf !== 1) {
          continue;
        }
        if (ring.linkHalf !== null && hit2 && ring.linkHalf !== 2) {
          continue;
        }
        const gain = collectRing(ring, audio);
        if (gain <= 0) {
          particles.emit(ring.pos, 10, 50, 120);
          rings.splice(i, 1);
          continue;
        }
        score += gain;
        particles.emit(ring.pos, ring.golden || ring.risk ? 26 : 14, ring.risk ? 30 : ring.golden ? 50 : 160, 200);
        audio.flare();
        if (ring.linkId !== null && gain >= 6) {
          for (let j = rings.length - 1; j >= 0; j -= 1) {
            if (rings[j].linkId === ring.linkId) {
              rings.splice(j, 1);
            }
          }
        } else {
          rings.splice(i, 1);
        }
      }
    }

    if (runTime <= 0) {
      runTime = 0;
      bestRings = Math.max(bestRings, score);
      lastCause = "Time!";
      phase = "matchEnd";
      if (!endHandled) beginEndSequence("rings", score);
    }
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      computeGeometry();
      resetComets();
    },

    startRound(): void {
      phase = "playing";
      resetLeaderboardState();
      beginMode();
    },

    restartRound(): void {
      if (nameEntry?.active) return;
      phase = "playing";
      resetLeaderboardState();
      beginMode();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 24);
      starPulse += dt;

      // Live gravity tuning, available on any screen.
      if (input.consumePress("BracketLeft")) {
        gravityScale = clamp(gravityScale - GRAVITY_STEP, GRAVITY_MIN, GRAVITY_MAX);
      }
      if (input.consumePress("BracketRight")) {
        gravityScale = clamp(gravityScale + GRAVITY_STEP, GRAVITY_MIN, GRAVITY_MAX);
      }

      // Mode selection on the title screen.
      if (phase === "title") {
        if (input.consumePress("Digit1")) {
          mode = "duel";
        } else if (input.consumePress("Digit2")) {
          mode = "flares";
        } else if (input.consumePress("Digit3")) {
          mode = "rings";
        }
      }

      if (phase === "roundEnd" || phase === "matchEnd") {
        if (phase === "matchEnd" && nameEntry?.active) {
          updateNameEntry(input);
        }
        roundTimer -= dt;
        if (roundTimer <= 0 && phase === "roundEnd") {
          phase = "playing";
          roundCount += 1;
          resetArena();
          resetComets();
          applyModeBoundaries();
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      updateComet(comet1, p1, input.primaryReleased(1), dt, audio);
      updateComet(comet2, p2, input.primaryReleased(2), dt, audio);

      comet1.pos = add(comet1.pos, scale(comet1.vel, dt));
      comet2.pos = add(comet2.pos, scale(comet2.vel, dt));

      for (const c of [comet1, comet2]) {
        c.trail.push(vec(c.pos.x, c.pos.y));
        if (c.trail.length > 22) {
          c.trail.shift();
        }
      }

      if (mode === "duel") {
        updateDuel(audio);
      } else if (mode === "flares") {
        updateFlares(dt, audio);
      } else {
        updateRings(dt, audio);
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      // Deep space.
      ctx.fillStyle = "#04030a";
      ctx.fillRect(0, 0, rw, rh);

      // Faint gravity-field rings out to the void edge.
      ctx.save();
      ctx.strokeStyle = "rgba(255, 170, 90, 0.05)";
      ctx.lineWidth = 1;
      for (let r = coronaR + 40; r < voidR; r += 46) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // The void edge — drift past it and you're gone.
      ctx.save();
      const nearVoid = Math.max(voidDanger(comet1), voidDanger(comet2));
      ctx.strokeStyle = `rgba(120, 150, 255, ${0.18 + nearVoid * 0.4})`;
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 1.5 + nearVoid * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, voidR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Collectible rings (Rings mode).
      for (const ring of rings) {
        const glow = 0.6 + Math.sin(ring.pulse) * 0.2;
        const lifeMax = ring.risk ? RING_LIFE_RISK : RING_LIFE;
        const fade = clamp(ring.life / lifeMax, 0, 1);
        const hue = ring.risk ? 30 : ring.golden ? 48 : 165;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${glow * fade})`;
        ctx.shadowColor = `hsl(${hue}, 100%, 55%)`;
        ctx.shadowBlur = ring.linkId !== null ? 18 : 14;
        ctx.lineWidth = ring.risk ? 5 : ring.golden ? 4 : 3;
        if (ring.linkId !== null) {
          ctx.setLineDash([5, 6]);
        }
        ctx.beginPath();
        ctx.arc(ring.pos.x, ring.pos.y, RING_R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

      // Plasma bolts (Flares mode).
      for (const b of bolts) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        if (b.homing) {
          ctx.fillStyle = "rgba(255, 90, 120, 0.9)";
          ctx.shadowColor = "rgba(255, 40, 80, 0.95)";
        } else {
          ctx.fillStyle = "rgba(255, 170, 70, 0.85)";
          ctx.shadowColor = "rgba(255, 110, 30, 0.9)";
        }
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.arc(b.pos.x, b.pos.y, BOLT_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // The star: layered radial glow with a slow pulse.
      const telegraphBoost = starTelegraph > 0 ? starTelegraph / BOLT_TELEGRAPH : 0;
      const pulse = 1 + Math.sin(starPulse * 2.2) * 0.06 + telegraphBoost * 0.18;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coronaR * 2.6 * pulse);
      glow.addColorStop(0, "rgba(255, 240, 210, 0.95)");
      glow.addColorStop(0.28, "rgba(255, 180, 90, 0.75)");
      glow.addColorStop(0.6, "rgba(255, 110, 40, 0.28)");
      glow.addColorStop(1, "rgba(255, 80, 20, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR * 2.6 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // The lethal corona ring.
      ctx.strokeStyle = "rgba(255, 150, 60, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR, 0, Math.PI * 2);
      ctx.stroke();

      // Bright core.
      ctx.fillStyle = "rgba(255, 250, 235, 0.95)";
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR * 0.55 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const drawComet = (c: Comet, label: string): void => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const n = c.trail.length;
        for (let i = 0; i < n; i += 1) {
          const t = (i + 1) / n;
          const p = c.trail[i];
          ctx.fillStyle = `hsla(${c.hue}, 100%, 62%, ${t * 0.3})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, SHIP_R * t * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = `hsl(${c.hue}, 100%, 58%)`;
        ctx.shadowColor = `hsl(${c.hue}, 100%, 50%)`;
        ctx.shadowBlur = 16 + c.charge * 22;
        ctx.beginPath();
        ctx.arc(c.pos.x, c.pos.y, SHIP_R, 0, Math.PI * 2);
        ctx.fill();

        // Corona-proximity warning ring.
        const burnDanger = coronaDanger(c);
        if (burnDanger > 0.01) {
          ctx.strokeStyle = `rgba(255, 200, 120, ${burnDanger * 0.9})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.pos.x, c.pos.y, SHIP_R + 4 + burnDanger * 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (c.stagger > 0) {
          ctx.strokeStyle = `hsla(${c.hue}, 100%, 75%, ${c.stagger / STAGGER_TIME})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.pos.x, c.pos.y, SHIP_R + 12, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (c.shield > 0) {
          ctx.strokeStyle = `hsla(${c.hue}, 100%, 85%, ${c.shield / SHIELD_TIME})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(c.pos.x, c.pos.y, SHIP_R + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (c.charge > 0.05) {
          const dir = c.dashDir;
          ctx.strokeStyle = `hsla(${c.hue}, 100%, 72%, ${c.charge})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(c.pos.x, c.pos.y);
          ctx.lineTo(
            c.pos.x + dir.x * (20 + c.charge * 44),
            c.pos.y + dir.y * (20 + c.charge * 44)
          );
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(label, c.pos.x, c.pos.y - SHIP_R - 10);
        ctx.restore();
      };

      drawComet(comet1, "P1");
      drawComet(comet2, "P2");

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      const grav = `Gravity ${gravityScale.toFixed(1)}×`;
      if (mode === "flares") {
        return {
          left: `Wave ${waveIndex + 1} · Lives ${sharedLives}`,
          center:
            phase === "playing"
              ? `FLARES · Survived ${formatTime(survivalTime)} · ${grav}`
              : phase === "matchEnd"
                ? lastCause
                : "",
          right: `Best ${formatTime(bestFlares)}`
        };
      }
      if (mode === "rings") {
        const comboLabel = combo > 1 ? ` · ×${combo}` : "";
        return {
          left: `Score ${score}${comboLabel}`,
          center:
            phase === "playing"
              ? `RINGS · ${formatTime(runTime)} left · ${grav}`
              : phase === "matchEnd"
                ? lastCause
                : "",
          right: `Best ${bestRings}`
        };
      }
      const speed1 = Math.round(len(comet1.vel));
      const speed2 = Math.round(len(comet2.vel));
      return {
        left: `P1 ${winsP1}  ·  ${speed1}`,
        center:
          phase === "playing"
            ? `DUEL · Round ${roundCount} · ${grav}`
            : phase === "roundEnd" && lastRoundWinner !== null
              ? `P${lastRoundWinner} wins — ${lastCause}`
              : "",
        right: `${speed2}  ·  ${winsP2} P2`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        const menu =
          "Choose a mode:\n" +
          `${MODE_TITLE_LINE.duel}\n` +
          `${MODE_TITLE_LINE.flares}\n` +
          `${MODE_TITLE_LINE.rings}\n\n` +
          `▶ selected: ${MODE_LABEL[mode]}\n\n` +
          CONTROLS;
        return {
          title: "NOVA",
          body: menu + "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "matchEnd") {
        if (mode === "duel" && matchWinner !== null) {
          return {
            title: `PLAYER ${matchWinner} WINS`,
            body: `Match score ${winsP1} — ${winsP2}\n${lastCause}\nPress R to restart.`,
            visible: true
          };
        }
        if (mode === "flares") {
          const header = `Survived ${formatTime(survivalTime)}\n${lastCause}\nBest ${formatTime(bestFlares)}`;
          const footer = "Press R to fly again";
          if (!leaderboardActive) {
            return { title: `SURVIVED ${formatTime(survivalTime)}`, body: `${header}\n${footer}`, visible: true };
          }
          if (nameEntry?.active) {
            const typed = nameEntry.chars.join("");
            const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
            return {
              title: "NEW HIGH SCORE!",
              body:
                `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\n` +
                `Type A–Z / 0–9  ·  Backspace  ·  Enter to save`,
              visible: true
            };
          }
          const status =
            submitState === "submitting"
              ? "\nSaving…"
              : submitState === "error"
                ? "\n(couldn't reach leaderboard — score not saved)"
                : "";
          return {
            title: `SURVIVED ${formatTime(survivalTime)}`,
            body: `${header}${status}\n\n${formatBoard(MODE_LABEL.flares)}\n\n${footer}`,
            visible: true
          };
        }
        const ringsHeader = `Score ${score} rings\nBest ${bestRings}`;
        const ringsFooter = "Press R to run it back";
        if (!leaderboardActive) {
          return { title: `TIME!  ${score} RINGS`, body: `${ringsHeader}\n${ringsFooter}`, visible: true };
        }
        if (nameEntry?.active) {
          const typed = nameEntry.chars.join("");
          const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
          return {
            title: "NEW HIGH SCORE!",
            body:
              `${ringsHeader}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\n` +
              `Type A–Z / 0–9  ·  Backspace  ·  Enter to save`,
            visible: true
          };
        }
        const ringsStatus =
          submitState === "submitting"
            ? "\nSaving…"
            : submitState === "error"
              ? "\n(couldn't reach leaderboard — score not saved)"
              : "";
        return {
          title: `TIME!  ${score} RINGS`,
          body: `${ringsHeader}${ringsStatus}\n\n${formatBoard(MODE_LABEL.rings)}\n\n${ringsFooter}`,
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
