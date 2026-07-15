import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import {
  CHASE_MATCH_SECONDS,
  CONTROLS,
  DUEL_WIN_ROUNDS,
  ECHO_DEPTH_DEFAULT,
  ECHO_DEPTH_MAX,
  ECHO_DEPTH_MIN,
  HAUNT_LAPS,
  MODE_DESCRIPTION,
  MODE_HELP,
  MODE_LABEL,
  hueForLap,
  type ModeId
} from "./modes";
import { FLAG_PRIMARY, Ghost, LAP_SECONDS, Recorder, packFlags, type Recording } from "./recorder";
import { clamp, dist, len, sub, vec, type Vec } from "./vec";
import { getLeaderboard, qualifies, submitScore, type LeaderboardEntry } from "@arcade/leaderboard";

const LEADERBOARD_GAME = "ghost";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

export type GamePhase = "title" | "playing" | "lapEnd" | "matchEnd";

type Rect = { x: number; y: number; w: number; h: number };

const MARGIN = 44;
const PLAYER_R = 14;
const ACCEL = 900;
const MAX_SPEED = 230;

// Chase
const ORB_R = 12;
const GRAB_R = PLAYER_R + ORB_R + 10;
const CARRY_SPEED_BASE = 80;
const CARRY_SPEED_PER_EXTRA = 40;
const CARRY_SPEED_MAX = 230;
const CHASE_GOAL_W = 70;

// Haunt
const SPARK_R = 9;
const PICKUP_R = PLAYER_R + SPARK_R + 4;
const GHOST_TOUCH_R = PLAYER_R * 2 - 2;
const SPARK_COUNT = 5;
const STUN_DUR = 0.6;
const STREAK_CAP = 4;

// Duel
const STRIKE_WINDUP = 0.06;
const STRIKE_ACTIVE = 0.09;
const STRIKE_RECOVER = 0.22;
const STRIKE_COOLDOWN = 0.12;
const STRIKE_RANGE_OFFSET = 26;
const STRIKE_R = 16;
const TELEGRAPH_TICKS = 18; // ~0.15s lookahead at 120Hz

const LAP_PAUSE_SECONDS = 0.9;
const ROUND_PAUSE_SECONDS = 1.0;
const NEAR_BAND = 26;

type StrikeState = "idle" | "windup" | "active" | "recover";

type Player = {
  id: 1 | 2;
  hue: number;
  pos: Vec;
  vel: Vec;
  angle: number;
  // haunt
  score: number;
  streak: number;
  stunTimer: number;
  // duel
  strikeState: StrikeState;
  strikeTimer: number;
  cooldown: number;
  prevPrimary: boolean;
  parrying: boolean;
  roundWins: number;
};

type GhostEntry = { ghost: Ghost; owner: 1 | 2 };
type Spark = { pos: Vec };
type Orb = { pos: Vec; carried: boolean };

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startMatch: () => void;
  restartMatch: () => void;
  update: (
    dt: number,
    p1: PlayerInput,
    p2: PlayerInput,
    input: InputManager,
    audio: AudioSystem
  ) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const MODE_IDS: ModeId[] = ["chase", "haunt", "duel"];
const MODE_DIGIT: Record<ModeId, string> = { chase: "1", haunt: "2", duel: "3" };

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let currentMode: ModeId = "chase";
  let echoDepth = ECHO_DEPTH_DEFAULT;
  let shake = 0;
  let rewindShimmer = 0;
  let nearMissFlash = 0;
  let pauseTimer = 0;

  const particles = new ParticleSystem();

  const makePlayer = (id: 1 | 2, hue: number): Player => ({
    id,
    hue,
    pos: vec(0, 0),
    vel: vec(0, 0),
    angle: 0,
    score: 0,
    streak: 1,
    stunTimer: 0,
    strikeState: "idle",
    strikeTimer: 0,
    cooldown: 0,
    prevPrimary: false,
    parrying: false,
    roundWins: 0
  });

  const p1: Player = makePlayer(1, 195);
  const p2: Player = makePlayer(2, 325);

  const recorder1 = new Recorder();
  const recorder2 = new Recorder();
  const ghosts: GhostEntry[] = [];
  let lapIndex = 0;
  let lapTimer = LAP_SECONDS;

  // Chase state
  const orb: Orb = { pos: vec(0, 0), carried: false };
  let chaseLegs = 0;
  let chaseMatchTimer = CHASE_MATCH_SECONDS;

  // Haunt state
  const sparks: Spark[] = [];
  let hauntLapsElapsed = 0;

  // Duel state
  let duelWinner: 1 | 2 | null = null;

  // Leaderboard state (Chase + Haunt only; Duel has no board)
  let endScore = 0;
  let leaderboardActive = false;
  let nameEntry: NameEntry | null = null;
  let board: LeaderboardEntry[] = [];
  let submitState: SubmitState = "idle";
  let justSubmitted: { name: string; score: number } | null = null;

  const arena = (): Rect => ({
    x: MARGIN,
    y: MARGIN,
    w: w - MARGIN * 2,
    h: h - MARGIN * 2
  });

  const currentBoard = (): "chase" | "haunt" => (currentMode === "chase" ? "chase" : "haunt");

  const resetLeaderboardState = (): void => {
    leaderboardActive = false;
    nameEntry = null;
    board = [];
    submitState = "idle";
    justSubmitted = null;
  };

  const beginLeaderboardSequence = (score: number): void => {
    endScore = score;
    submitState = "idle";
    justSubmitted = null;
    nameEntry = null;
    leaderboardActive = false;
    board = [];
    const boardId = currentBoard();
    const mode = currentMode;
    getLeaderboard(LEADERBOARD_GAME, boardId).then((state) => {
      if (currentMode !== mode || phase !== "matchEnd") return;
      if (!state.enabled) return;
      leaderboardActive = true;
      board = state.entries;
      if (qualifies(state.entries, endScore)) {
        nameEntry = { active: true, chars: [] };
      }
    });
  };

  const confirmName = (): void => {
    const ne = nameEntry;
    if (!ne) return;
    const name = ne.chars.join("");
    const boardId = currentBoard();
    const mode = currentMode;
    nameEntry = null;
    submitState = "submitting";
    justSubmitted = { name, score: endScore };
    submitScore(LEADERBOARD_GAME, boardId, name, endScore).then((res) => {
      if (currentMode !== mode || phase !== "matchEnd") return;
      if (res) {
        board = res.entries;
        submitState = "done";
      } else {
        submitState = "error";
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

  const formatBoard = (): string => {
    const heading = `— GHOST · ${MODE_LABEL[currentMode]} —`;
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
      const score = String(Math.round(e.score)).padStart(7, " ");
      return `${marker}${rank}. ${name} ${score}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  };

  // ---- ghost pool -------------------------------------------------------

  const pruneToEchoDepth = (): void => {
    for (const owner of [1, 2] as const) {
      let count = 0;
      for (let i = ghosts.length - 1; i >= 0; i -= 1) {
        if (ghosts[i].owner === owner) {
          count += 1;
          if (count > echoDepth) ghosts.splice(i, 1);
        }
      }
    }
  };

  const addGhost = (owner: 1 | 2, rec: Recording): void => {
    if (rec.len < 2) return;
    ghosts.push({ ghost: new Ghost(rec), owner });
    pruneToEchoDepth();
  };

  // ---- spawn / reset ------------------------------------------------------

  const confine = (pos: Vec, r = PLAYER_R): void => {
    const a = arena();
    pos.x = clamp(pos.x, a.x + r, a.x + a.w - r);
    pos.y = clamp(pos.y, a.y + r, a.y + a.h - r);
  };

  const spawnChase = (): void => {
    const a = arena();
    p1.pos = vec(a.x + 70, a.y + a.h * 0.5 - 24);
    p2.pos = vec(a.x + 70, a.y + a.h * 0.5 + 24);
    p1.vel = vec(0, 0);
    p2.vel = vec(0, 0);
    p1.angle = 0;
    p2.angle = 0;
  };

  const spawnHaunt = (): void => {
    const a = arena();
    p1.pos = vec(a.x + 44, a.y + 44);
    p2.pos = vec(a.x + a.w - 44, a.y + a.h - 44);
    p1.vel = vec(0, 0);
    p2.vel = vec(0, 0);
    p1.angle = 0;
    p2.angle = Math.PI;
  };

  const spawnDuel = (): void => {
    const a = arena();
    p1.pos = vec(a.x + a.w * 0.22, a.y + a.h * 0.5);
    p2.pos = vec(a.x + a.w * 0.78, a.y + a.h * 0.5);
    p1.vel = vec(0, 0);
    p2.vel = vec(0, 0);
    p1.angle = 0;
    p2.angle = Math.PI;
    for (const p of [p1, p2]) {
      p.strikeState = "idle";
      p.strikeTimer = 0;
      p.cooldown = 0;
      p.prevPrimary = false;
      p.parrying = false;
    }
  };

  const respawnPlayers = (): void => {
    if (currentMode === "chase") spawnChase();
    else if (currentMode === "haunt") spawnHaunt();
    else spawnDuel();
  };

  const resetOrbToStart = (): void => {
    const a = arena();
    orb.pos = vec(a.x + 70, a.y + a.h * 0.5);
    orb.carried = false;
  };

  const randomSparkPos = (): Vec => {
    const a = arena();
    const pad = SPARK_R + 24;
    return vec(a.x + pad + Math.random() * (a.w - pad * 2), a.y + pad + Math.random() * (a.h - pad * 2));
  };

  const ensureSparks = (): void => {
    while (sparks.length < SPARK_COUNT) {
      sparks.push({ pos: randomSparkPos() });
    }
  };

  // ---- lap lifecycle --------------------------------------------------

  const enterChaseMatchEnd = (): void => {
    phase = "matchEnd";
    beginLeaderboardSequence(chaseLegs);
  };

  const enterHauntMatchEnd = (): void => {
    phase = "matchEnd";
    beginLeaderboardSequence(Math.max(p1.score, p2.score));
  };

  const naturalLapBoundary = (audio: AudioSystem): void => {
    const hue = hueForLap(lapIndex);
    const recA = recorder1.freeze(hue);
    const recB = recorder2.freeze(hue);
    addGhost(1, recA);
    addGhost(2, recB);
    lapIndex += 1;
    lapTimer = LAP_SECONDS;
    for (const g of ghosts) g.ghost.resetPlayhead();

    if (currentMode === "chase") {
      resetOrbToStart();
    } else if (currentMode === "haunt") {
      hauntLapsElapsed += 1;
      if (hauntLapsElapsed >= HAUNT_LAPS) {
        enterHauntMatchEnd();
        return;
      }
    }

    respawnPlayers();
    rewindShimmer = 1;
    audio.spawn();
    phase = "lapEnd";
    pauseTimer = LAP_PAUSE_SECONDS;
  };

  // ---- movement ---------------------------------------------------------

  const updatePlayerMovement = (p: Player, input: PlayerInput, dt: number): void => {
    const moving = p.stunTimer <= 0;
    const ax = moving ? input.x : 0;
    const ay = moving ? input.y : 0;
    const mag = Math.hypot(ax, ay);
    if (mag > 0.0001) {
      p.vel.x += (ax / mag) * ACCEL * dt;
      p.vel.y += (ay / mag) * ACCEL * dt;
    } else {
      const f = Math.pow(0.86, dt * 60);
      p.vel.x *= f;
      p.vel.y *= f;
    }
    const speed = Math.hypot(p.vel.x, p.vel.y);
    if (speed > MAX_SPEED) {
      p.vel.x = (p.vel.x / speed) * MAX_SPEED;
      p.vel.y = (p.vel.y / speed) * MAX_SPEED;
    }
    p.pos.x += p.vel.x * dt;
    p.pos.y += p.vel.y * dt;
    confine(p.pos);
    if (speed > 8) {
      p.angle = Math.atan2(p.vel.y, p.vel.x);
    }
  };

  // ---- Chase --------------------------------------------------------------

  const updateChase = (dt: number, p1in: PlayerInput, p2in: PlayerInput, audio: AudioSystem): void => {
    const a = arena();
    const goalX = a.x + a.w - CHASE_GOAL_W;

    const carriers: Vec[] = [];
    if (p1in.primary && dist(p1.pos, orb.pos) <= GRAB_R) carriers.push(p1.pos);
    if (p2in.primary && dist(p2.pos, orb.pos) <= GRAB_R) carriers.push(p2.pos);
    for (const { ghost } of ghosts) {
      if ((ghost.flags & FLAG_PRIMARY) !== 0 && dist(vec(ghost.x, ghost.y), orb.pos) <= GRAB_R) {
        carriers.push(vec(ghost.x, ghost.y));
      }
    }

    if (carriers.length > 0) {
      let cx = 0;
      let cy = 0;
      for (const c of carriers) {
        cx += c.x;
        cy += c.y;
      }
      cx /= carriers.length;
      cy /= carriers.length;
      const toward = sub(vec(cx, cy), orb.pos);
      const d = len(toward);
      const speed = Math.min(CARRY_SPEED_BASE + (carriers.length - 1) * CARRY_SPEED_PER_EXTRA, CARRY_SPEED_MAX);
      const step = Math.min(speed * dt, d);
      if (d > 0.001) {
        orb.pos.x += (toward.x / d) * step;
        orb.pos.y += (toward.y / d) * step;
      }
      orb.carried = true;
    } else {
      orb.carried = false;
    }
    orb.pos.x = clamp(orb.pos.x, a.x + ORB_R, a.x + a.w - ORB_R);
    orb.pos.y = clamp(orb.pos.y, a.y + ORB_R, a.y + a.h - ORB_R);

    if (orb.pos.x >= goalX) {
      chaseLegs += 1;
      shake = Math.max(shake, 10);
      particles.emit(vec(orb.pos.x, orb.pos.y), 34, 265, 200);
      audio.win();
      naturalLapBoundary(audio);
    }
  };

  // ---- Haunt --------------------------------------------------------------

  const hitByGhost = (p: Player, audio: AudioSystem): void => {
    if (p.stunTimer > 0) return;
    if (p.streak > 1) {
      particles.emit(vec(p.pos.x, p.pos.y), 14, 0, 140);
    }
    p.streak = 1;
    p.stunTimer = STUN_DUR;
    shake = Math.max(shake, 6);
    audio.explode();
  };

  const updateHaunt = (dt: number, audio: AudioSystem): void => {
    ensureSparks();
    for (const p of [p1, p2]) {
      p.stunTimer = Math.max(0, p.stunTimer - dt);
    }

    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const s = sparks[i];
      for (const p of [p1, p2]) {
        if (p.stunTimer > 0) continue;
        if (dist(p.pos, s.pos) <= PICKUP_R) {
          p.streak = Math.min(STREAK_CAP, p.streak + 1);
          p.score += p.streak;
          particles.emit(vec(s.pos.x, s.pos.y), 18, p.hue, 150);
          audio.bounce();
          sparks.splice(i, 1);
          break;
        }
      }
    }
    ensureSparks();

    const checkHazard = (p: Player, other: Player): void => {
      if (p.stunTimer > 0) return;
      if (dist(p.pos, other.pos) <= GHOST_TOUCH_R) {
        hitByGhost(p, audio);
        return;
      }
      for (const { ghost } of ghosts) {
        if (dist(p.pos, vec(ghost.x, ghost.y)) <= GHOST_TOUCH_R) {
          hitByGhost(p, audio);
          return;
        }
      }
    };
    checkHazard(p1, p2);
    checkHazard(p2, p1);
  };

  // ---- Duel -----------------------------------------------------------

  const updateDuelPlayer = (p: Player, input: PlayerInput, dt: number): void => {
    p.cooldown = Math.max(0, p.cooldown - dt);
    const pressedPrimary = input.primary && !p.prevPrimary;
    p.prevPrimary = input.primary;
    if (pressedPrimary && p.strikeState === "idle" && p.cooldown <= 0) {
      p.strikeState = "windup";
      p.strikeTimer = STRIKE_WINDUP;
    }
    if (p.strikeState === "windup") {
      p.strikeTimer -= dt;
      if (p.strikeTimer <= 0) {
        p.strikeState = "active";
        p.strikeTimer = STRIKE_ACTIVE;
      }
    } else if (p.strikeState === "active") {
      p.strikeTimer -= dt;
      if (p.strikeTimer <= 0) {
        p.strikeState = "recover";
        p.strikeTimer = STRIKE_RECOVER;
      }
    } else if (p.strikeState === "recover") {
      p.strikeTimer -= dt;
      if (p.strikeTimer <= 0) {
        p.strikeState = "idle";
        p.cooldown = STRIKE_COOLDOWN;
      }
    }
    p.parrying = input.secondary;
  };

  const strikeHitCenter = (pos: Vec, angle: number): Vec =>
    vec(pos.x + Math.cos(angle) * STRIKE_RANGE_OFFSET, pos.y + Math.sin(angle) * STRIKE_RANGE_OFFSET);

  const awardRoundTo = (winnerId: 1 | 2, audio: AudioSystem): void => {
    const winner = winnerId === 1 ? p1 : p2;
    winner.roundWins += 1;
    shake = Math.max(shake, 14);
    audio.explode();
    particles.emit(vec(p1.pos.x, p1.pos.y), 16, p1.hue, 160);
    particles.emit(vec(p2.pos.x, p2.pos.y), 16, p2.hue, 160);
    if (winner.roundWins >= DUEL_WIN_ROUNDS) {
      duelWinner = winnerId;
      phase = "matchEnd";
      audio.win();
    } else {
      respawnPlayers();
      phase = "lapEnd";
      pauseTimer = ROUND_PAUSE_SECONDS;
    }
  };

  // ---- shared tick --------------------------------------------------------

  const updateNearMiss = (dt: number): void => {
    nearMissFlash = Math.max(0, nearMissFlash - dt * 2.2);
    for (const p of [p1, p2]) {
      for (const { ghost } of ghosts) {
        const d = dist(p.pos, vec(ghost.x, ghost.y));
        if (d > GHOST_TOUCH_R && d < GHOST_TOUCH_R + NEAR_BAND) {
          nearMissFlash = Math.max(nearMissFlash, 0.5);
        }
      }
    }
  };

  const startMatchInternal = (): void => {
    phase = "playing";
    resetLeaderboardState();
    lapIndex = 0;
    lapTimer = LAP_SECONDS;
    ghosts.length = 0;
    recorder1.reset();
    recorder2.reset();
    particles.clear();
    sparks.length = 0;

    p1.score = 0;
    p2.score = 0;
    p1.streak = 1;
    p2.streak = 1;
    p1.stunTimer = 0;
    p2.stunTimer = 0;
    p1.roundWins = 0;
    p2.roundWins = 0;
    duelWinner = null;
    chaseLegs = 0;
    chaseMatchTimer = CHASE_MATCH_SECONDS;
    hauntLapsElapsed = 0;

    respawnPlayers();
    if (currentMode === "chase") resetOrbToStart();
    if (currentMode === "haunt") ensureSparks();
  };

  const handleTitleInput = (input: InputManager): void => {
    if (input.consumePress("Digit1")) currentMode = "chase";
    else if (input.consumePress("Digit2")) currentMode = "haunt";
    else if (input.consumePress("Digit3")) currentMode = "duel";
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
    },

    startMatch(): void {
      startMatchInternal();
    },

    restartMatch(): void {
      if (nameEntry?.active) return;
      startMatchInternal();
    },

    update(dt, p1in, p2in, input, audio): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 26);
      rewindShimmer = Math.max(0, rewindShimmer - dt * 1.6);

      if (input.consumePress("BracketLeft")) {
        echoDepth = clamp(echoDepth - 1, ECHO_DEPTH_MIN, ECHO_DEPTH_MAX);
        pruneToEchoDepth();
      }
      if (input.consumePress("BracketRight")) {
        echoDepth = clamp(echoDepth + 1, ECHO_DEPTH_MIN, ECHO_DEPTH_MAX);
        pruneToEchoDepth();
      }

      if (phase === "title") {
        handleTitleInput(input);
        return;
      }

      if (phase === "matchEnd") {
        if (currentMode !== "duel") {
          if (nameEntry?.active) {
            updateNameEntry(input);
          }
        }
        return;
      }

      if (currentMode === "chase") {
        chaseMatchTimer -= dt;
        if (chaseMatchTimer <= 0) {
          enterChaseMatchEnd();
          return;
        }
      }

      if (phase === "lapEnd") {
        pauseTimer -= dt;
        if (pauseTimer <= 0) {
          phase = "playing";
        }
        return;
      }

      // phase === "playing"
      lapTimer -= dt;

      updatePlayerMovement(p1, p1in, dt);
      updatePlayerMovement(p2, p2in, dt);

      recorder1.sample(p1.pos.x, p1.pos.y, p1.angle, packFlags(p1in.primary, p1in.secondary));
      recorder2.sample(p2.pos.x, p2.pos.y, p2.angle, packFlags(p2in.primary, p2in.secondary));
      for (const g of ghosts) g.ghost.advance();

      updateNearMiss(dt);

      if (currentMode === "chase") {
        updateChase(dt, p1in, p2in, audio);
      } else if (currentMode === "haunt") {
        updateHaunt(dt, audio);
      } else {
        updateDuelPlayer(p1, p1in, dt);
        updateDuelPlayer(p2, p2in, dt);

        let resolved = false;
        if (p1.strikeState === "active") {
          const hc = strikeHitCenter(p1.pos, p1.angle);
          if (dist(hc, p2.pos) <= STRIKE_R + PLAYER_R) {
            if (p2.parrying) {
              audio.bounce();
              particles.emit(hc, 10, p2.hue, 120);
            } else {
              awardRoundTo(1, audio);
              resolved = true;
            }
          }
        }
        if (!resolved && p2.strikeState === "active") {
          const hc = strikeHitCenter(p2.pos, p2.angle);
          if (dist(hc, p1.pos) <= STRIKE_R + PLAYER_R) {
            if (p1.parrying) {
              audio.bounce();
              particles.emit(hc, 10, p1.hue, 120);
            } else {
              awardRoundTo(2, audio);
              resolved = true;
            }
          }
        }
        if (!resolved) {
          for (const { ghost } of ghosts) {
            if (!ghost.flagRose(FLAG_PRIMARY)) continue;
            const hc = strikeHitCenter(vec(ghost.x, ghost.y), ghost.angle);
            for (const defender of [p1, p2] as const) {
              if (dist(hc, defender.pos) <= STRIKE_R + PLAYER_R) {
                if (defender.parrying) {
                  audio.bounce();
                  particles.emit(hc, 10, defender.hue, 120);
                } else {
                  const winnerId = defender.id === 1 ? 2 : 1;
                  awardRoundTo(winnerId, audio);
                  resolved = true;
                }
                break;
              }
            }
            if (resolved) break;
          }
        }
      }

      if (phase === "playing" && lapTimer <= 0) {
        naturalLapBoundary(audio);
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) return;
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      ctx.fillStyle = "#07070c";
      ctx.fillRect(0, 0, rw, rh);

      const a = arena();

      ctx.fillStyle = "#0c0a16";
      ctx.fillRect(a.x, a.y, a.w, a.h);

      ctx.strokeStyle = "rgba(180,140,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = a.x; x <= a.x + a.w; x += 44) {
        ctx.moveTo(x + 0.5, a.y);
        ctx.lineTo(x + 0.5, a.y + a.h);
      }
      for (let y = a.y; y <= a.y + a.h; y += 44) {
        ctx.moveTo(a.x, y + 0.5);
        ctx.lineTo(a.x + a.w, y + 0.5);
      }
      ctx.stroke();

      ctx.strokeStyle = "rgba(180,140,255,0.35)";
      ctx.lineWidth = 3;
      ctx.strokeRect(a.x, a.y, a.w, a.h);

      if (currentMode === "chase") {
        const goalX = a.x + a.w - CHASE_GOAL_W;
        ctx.fillStyle = "rgba(120,255,220,0.08)";
        ctx.fillRect(goalX, a.y, CHASE_GOAL_W, a.h);
        ctx.strokeStyle = "rgba(120,255,220,0.5)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 6]);
        ctx.beginPath();
        ctx.moveTo(goalX, a.y);
        ctx.lineTo(goalX, a.y + a.h);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Ghosts — desaturated/translucent, oldest = faintest, per-lap hue.
      for (const { ghost, owner } of ghosts) {
        const age = lapIndex - ghost.rec.lap;
        const alpha = clamp(0.62 - age * 0.09, 0.14, 0.62);
        const telegraph =
          currentMode === "duel" && ghost.peekFlagRises(FLAG_PRIMARY, TELEGRAPH_TICKS);
        ctx.save();
        ctx.translate(ghost.x, ghost.y);
        ctx.rotate(ghost.angle);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `hsl(${ghost.rec.hue}, 55%, 60%)`;
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `hsla(${ghost.rec.hue}, 70%, 75%, 0.8)`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(PLAYER_R + 6, 0);
        ctx.stroke();
        ctx.restore();
        if (telegraph) {
          const pulse = 0.5 + 0.5 * Math.sin(performance.now() * 0.03);
          ctx.save();
          ctx.strokeStyle = `rgba(255,90,90,${0.5 + pulse * 0.4})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ghost.x, ghost.y, PLAYER_R + 8, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        ctx.save();
        ctx.globalAlpha = Math.min(alpha + 0.2, 0.9);
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "9px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(`P${owner}`, ghost.x, ghost.y - PLAYER_R - 6);
        ctx.restore();
      }

      // Chase orb
      if (currentMode === "chase") {
        ctx.save();
        const pulse = orb.carried ? 0.5 + 0.5 * Math.sin(performance.now() * 0.02) : 0;
        ctx.shadowColor = `rgba(120,255,220,${0.6 + pulse * 0.4})`;
        ctx.shadowBlur = orb.carried ? 20 : 10;
        ctx.fillStyle = "rgba(150,255,225,0.9)";
        ctx.beginPath();
        ctx.arc(orb.pos.x, orb.pos.y, ORB_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // Haunt sparks
      if (currentMode === "haunt") {
        for (const s of sparks) {
          ctx.save();
          ctx.shadowColor = "rgba(255,220,120,0.8)";
          ctx.shadowBlur = 10;
          ctx.fillStyle = "rgba(255,225,150,0.9)";
          ctx.beginPath();
          ctx.arc(s.pos.x, s.pos.y, SPARK_R, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      // Live players
      for (const p of [p1, p2]) {
        const flick = p.stunTimer > 0 && Math.floor(p.stunTimer * 14) % 2 === 0;
        ctx.save();
        ctx.translate(p.pos.x, p.pos.y);
        ctx.rotate(p.angle);
        ctx.globalAlpha = flick ? 0.4 : 1;
        ctx.fillStyle = `hsl(${p.hue}, 85%, 58%)`;
        ctx.shadowColor = `hsl(${p.hue}, 90%, 55%)`;
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, 0, PLAYER_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(PLAYER_R + 7, 0);
        ctx.stroke();
        ctx.restore();

        if (currentMode === "duel") {
          if (p.parrying) {
            ctx.save();
            ctx.strokeStyle = "rgba(140,200,255,0.8)";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(p.pos.x, p.pos.y, PLAYER_R + 6, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
          }
          if (p.strikeState === "windup" || p.strikeState === "active") {
            const hc = strikeHitCenter(p.pos, p.angle);
            ctx.save();
            ctx.globalAlpha = p.strikeState === "active" ? 0.75 : 0.35;
            ctx.fillStyle = `hsl(${p.hue}, 100%, 70%)`;
            ctx.beginPath();
            ctx.arc(hc.x, hc.y, STRIKE_R, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(`P${p.id}`, p.pos.x, p.pos.y - PLAYER_R - 10);
      }

      particles.render(ctx);

      // Near-miss ripple — a faint full-field pulse when a live player skims
      // close to a ghost without actually touching it.
      if (nearMissFlash > 0) {
        ctx.save();
        ctx.fillStyle = `rgba(180,140,255,${nearMissFlash * 0.05})`;
        ctx.fillRect(0, 0, rw, rh);
        ctx.restore();
      }

      // Rewind shimmer — a scanline sweep across the arena at lap reset.
      if (rewindShimmer > 0) {
        ctx.save();
        const t = 1 - rewindShimmer;
        const sweepX = a.x + a.w * t;
        const grad = ctx.createLinearGradient(sweepX - 60, 0, sweepX + 60, 0);
        grad.addColorStop(0, "rgba(180,140,255,0)");
        grad.addColorStop(0.5, `rgba(200,170,255,${rewindShimmer * 0.35})`);
        grad.addColorStop(1, "rgba(180,140,255,0)");
        ctx.fillStyle = grad;
        ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.restore();
      }
    },

    getHud(): { left: string; center: string; right: string } {
      let center = "";
      if (phase === "playing" || phase === "lapEnd") {
        if (currentMode === "chase") {
          center = `CHASE · Leg ${chaseLegs} · Ghosts ${ghosts.length} · Echo ${echoDepth} · ${Math.max(0, Math.ceil(chaseMatchTimer))}s`;
        } else if (currentMode === "haunt") {
          center = `HAUNT · Lap ${Math.min(hauntLapsElapsed + 1, HAUNT_LAPS)}/${HAUNT_LAPS} · Ghosts ${ghosts.length} · Echo ${echoDepth}`;
        } else {
          center = `DUEL · Round ${p1.roundWins}-${p2.roundWins} · Ghosts ${ghosts.length} · Echo ${echoDepth}`;
        }
      }

      if (currentMode === "haunt") {
        return {
          left: `P1  ${p1.score}  x${p1.streak}`,
          center,
          right: `x${p2.streak}  ${p2.score}  P2`
        };
      }
      if (currentMode === "duel") {
        return {
          left: `P1  ${p1.roundWins}`,
          center,
          right: `${p2.roundWins}  P2`
        };
      }
      return { left: "P1", center, right: "P2" };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        const modeLines = MODE_IDS.map((m) => {
          const marker = m === currentMode ? "▸" : " ";
          return `${marker} ${MODE_DIGIT[m]} ${MODE_LABEL[m]} — ${MODE_DESCRIPTION[m]}`;
        }).join("\n");
        return {
          title: "GHOST",
          body:
            `${modeLines}\n\n${CONTROLS}\n\n` +
            `${MODE_HELP[currentMode]}\n\n` +
            "Enter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }

      if (phase === "matchEnd") {
        if (currentMode === "duel" && duelWinner !== null) {
          return {
            title: `PLAYER ${duelWinner} WINS`,
            body: `Rounds  ${p1.roundWins} — ${p2.roundWins}\nPress R to restart.`,
            visible: true
          };
        }
        if (currentMode !== "duel") {
          const header =
            currentMode === "chase"
              ? `Legs completed: ${chaseLegs}`
              : `P1  ${p1.score}   —   P2  ${p2.score}\n${p1.score === p2.score ? "Tie!" : p1.score > p2.score ? "P1 wins!" : "P2 wins!"}`;
          if (nameEntry?.active) {
            const typed = nameEntry.chars.join("");
            const cursor = nameEntry.chars.length < NAME_MAX ? "_" : "";
            return {
              title: "NEW HIGH SCORE!",
              body:
                `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\n` +
                "Type A–Z / 0–9  ·  Backspace  ·  Enter to save",
              visible: true
            };
          }
          const status =
            submitState === "submitting"
              ? "\nSaving…"
              : submitState === "error"
                ? "\n(couldn't reach leaderboard — score not saved)"
                : "";
          const boardText = leaderboardActive ? `\n\n${formatBoard()}` : "";
          return {
            title: `${MODE_LABEL[currentMode]} COMPLETE`,
            body: `${header}${status}${boardText}\n\nPress R to restart.`,
            visible: true
          };
        }
      }

      if (helpHeld) {
        return {
          title: "HOW TO PLAY",
          body: `${MODE_HELP[currentMode]}\n\n${CONTROLS}\n\nRelease H to resume`,
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
