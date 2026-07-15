import { AudioSystem } from "./audio";
import { CommsSystem } from "./comms";
import { FogMask } from "./fog";
import { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { Hud } from "./ui";
import { clamp, dist, normalize, sub, vec, type Vec } from "./vec";
import {
  DEFUSE_HELP,
  DEFUSE_SYMBOLS,
  DIRECTION_ARROW,
  ESCORT_HELP,
  defuseTimeLimit,
  escortWaveConfig,
  type Direction,
  type GameMode
} from "./modes";
import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "@arcade/leaderboard";

const LEADERBOARD_GAME = "relay";
const NAME_MAX = 8;

type Phase = "title" | "playing" | "ended";
type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

// --- ESCORT geometry -------------------------------------------------------

const ESCORT_WORLD_WIDTH = 640;
const ROOM_HEIGHT = 160;
const WALL_THICKNESS = 18;
const PILOT_RADIUS = 11;
const ESCORT_ACCEL = 560;
const EXIT_MARGIN = 10;
const DEPTH_UNIT = 20; // world px per displayed "meter" of depth

type Wall = {
  y: number;
  gapX: number;
  gapWidth: number;
  isGate: boolean;
  period: number;
  openFraction: number;
  phase: number;
};

type Mine = {
  pos: Vec;
  vel: Vec;
  radius: number;
  roomTop: number;
  roomBottom: number;
};

type Rect = { x0: number; x1: number; y0: number; y1: number };

type EscortWave = {
  worldWidth: number;
  worldHeight: number;
  walls: Wall[];
  mines: Mine[];
  fogRadius: number;
  timeLimit: number;
};

function buildEscortWave(waveNum: number): EscortWave {
  const cfg = escortWaveConfig(waveNum);
  const worldWidth = ESCORT_WORLD_WIDTH;
  const worldHeight = ROOM_HEIGHT * (cfg.roomCount + 1);

  const walls: Wall[] = [];
  for (let i = 0; i < cfg.roomCount; i += 1) {
    const y = ROOM_HEIGHT * (i + 1);
    const gapWidth = cfg.gapWidth;
    const gapX = clamp(
      Math.random() * worldWidth,
      gapWidth / 2 + 30,
      worldWidth - gapWidth / 2 - 30
    );
    const isGate = Math.random() < cfg.gateRoomChance;
    walls.push({
      y,
      gapX,
      gapWidth,
      isGate,
      period: cfg.gatePeriod,
      openFraction: cfg.gateOpenFraction,
      phase: Math.random() * cfg.gatePeriod
    });
  }

  const mines: Mine[] = [];
  for (let i = 0; i < cfg.mineCount; i += 1) {
    const roomIndex = Math.floor(Math.random() * (cfg.roomCount + 1));
    const roomTop = roomIndex * ROOM_HEIGHT;
    const roomBottom = roomTop + ROOM_HEIGHT;
    mines.push({
      pos: vec(
        30 + Math.random() * (worldWidth - 60),
        roomTop + 24 + Math.random() * (ROOM_HEIGHT - 48)
      ),
      vel: vec((Math.random() - 0.5) * 70, (Math.random() - 0.5) * 55),
      radius: 15,
      roomTop,
      roomBottom
    });
  }

  return { worldWidth, worldHeight, walls, mines, fogRadius: cfg.fogRadius, timeLimit: cfg.timeLimit };
}

function isGateOpen(wall: Wall, time: number): boolean {
  const t = (((time + wall.phase) % wall.period) + wall.period) % wall.period / wall.period;
  return t < wall.openFraction;
}

// A wall becomes 2 solid rects (left/right of the gap) plus, while a gate is
// shut, a 3rd rect that plugs the gap too.
function wallRects(wall: Wall, time: number, worldWidth: number): Rect[] {
  const y0 = wall.y - WALL_THICKNESS / 2;
  const y1 = wall.y + WALL_THICKNESS / 2;
  const gapL = wall.gapX - wall.gapWidth / 2;
  const gapR = wall.gapX + wall.gapWidth / 2;
  const rects: Rect[] = [
    { x0: 0, x1: Math.max(0, gapL), y0, y1 },
    { x0: Math.min(worldWidth, gapR), x1: worldWidth, y0, y1 }
  ];
  const open = wall.isGate ? isGateOpen(wall, time) : true;
  if (!open) {
    rects.push({ x0: gapL, x1: gapR, y0, y1 });
  }
  return rects;
}

// Circle-vs-AABB penetration push-out; null when there's no overlap.
function resolveCircleRect(circlePos: Vec, radius: number, rect: Rect): Vec | null {
  const cx = clamp(circlePos.x, rect.x0, rect.x1);
  const cy = clamp(circlePos.y, rect.y0, rect.y1);
  const dx = circlePos.x - cx;
  const dy = circlePos.y - cy;
  const distSq = dx * dx + dy * dy;
  if (distSq >= radius * radius) {
    return null;
  }
  const d = Math.sqrt(distSq);
  if (d < 0.0001) {
    const midY = (rect.y0 + rect.y1) / 2;
    const dir = circlePos.y < midY ? -1 : 1;
    return vec(0, dir * radius);
  }
  const push = radius - d;
  return vec((dx / d) * push, (dy / d) * push);
}

type EscortState = {
  wave: number;
  baseDepth: number;
  health: number;
  invulnTimer: number;
  fogMultiplier: number;
  time: number;
  timeLeft: number;
  worldWidth: number;
  worldHeight: number;
  baseFogRadius: number;
  walls: Wall[];
  mines: Mine[];
  pilot: { pos: Vec; vel: Vec };
  score: number;
};

// --- DEFUSE ------------------------------------------------------------

type FlashState = { kind: "correct" | "wrong" | null; timer: number };

type DefuseState = {
  wave: number;
  score: number;
  strikes: number;
  symbolIdx: number;
  buffer: Direction[];
  timeLeft: number;
  manualHighlight: number;
  flash: FlashState;
};

const DIRECTION_KEYS: [string, Direction][] = [
  ["KeyW", "up"],
  ["KeyA", "left"],
  ["KeyS", "down"],
  ["KeyD", "right"]
];

export class RelayGame {
  private phase: Phase = "title";
  private activeMode: GameMode = "escort";
  private canvasSize = { width: 1280, height: 720 };
  private shake = 0;
  private readonly particles = new ParticleSystem();
  private readonly comms = new CommsSystem();
  private readonly fog = new FogMask();

  private escort: EscortState = {
    wave: 1,
    baseDepth: 0,
    health: 100,
    invulnTimer: 0,
    fogMultiplier: 1,
    time: 0,
    timeLeft: 60,
    worldWidth: ESCORT_WORLD_WIDTH,
    worldHeight: ROOM_HEIGHT * 2,
    baseFogRadius: 140,
    walls: [],
    mines: [],
    pilot: { pos: vec(ESCORT_WORLD_WIDTH / 2, PILOT_RADIUS + 10), vel: vec(0, 0) },
    score: 0
  };

  private defuse: DefuseState = {
    wave: 1,
    score: 0,
    strikes: 0,
    symbolIdx: 0,
    buffer: [],
    timeLeft: defuseTimeLimit(1),
    manualHighlight: 0,
    flash: { kind: null, timer: 0 }
  };

  // Leaderboard / end-of-run state.
  private endHandled = false;
  private endScore = 0;
  private endBoardKey: GameMode = "escort";
  private board: LeaderboardEntry[] = [];
  private leaderboardActive = false;
  private nameEntry: NameEntry | null = null;
  private submitState: SubmitState = "idle";
  private justSubmitted: { name: string; score: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly hud: Hud,
    private readonly input: InputManager,
    private readonly audio: AudioSystem
  ) {}

  resize(width: number, height: number): void {
    this.canvasSize = { width, height };
  }

  private resetRound(): void {
    this.phase = "playing";
    this.endHandled = false;
    this.leaderboardActive = false;
    this.nameEntry = null;
    this.submitState = "idle";
    this.justSubmitted = null;
    this.shake = 0;
    this.particles.clear();
    if (this.activeMode === "escort") {
      this.resetEscort();
    } else {
      this.resetDefuse();
    }
  }

  // --- ESCORT --------------------------------------------------------------

  private resetEscort(): void {
    this.escort.health = 100;
    this.escort.invulnTimer = 0;
    this.escort.fogMultiplier = 1;
    this.escort.time = 0;
    this.escort.baseDepth = 0;
    this.escort.score = 0;
    this.loadEscortWave(1);
  }

  private loadEscortWave(wave: number): void {
    const w = buildEscortWave(wave);
    this.escort.wave = wave;
    this.escort.worldWidth = w.worldWidth;
    this.escort.worldHeight = w.worldHeight;
    this.escort.walls = w.walls;
    this.escort.mines = w.mines;
    this.escort.baseFogRadius = w.fogRadius;
    this.escort.timeLeft = w.timeLimit;
    this.escort.pilot.pos = vec(w.worldWidth / 2, PILOT_RADIUS + 10);
    this.escort.pilot.vel = vec(0, 0);
    this.comms.reset(w.worldWidth, w.worldHeight);
  }

  private registerHazardHit(): void {
    if (this.escort.invulnTimer > 0) {
      return;
    }
    this.escort.invulnTimer = 0.6;
    this.escort.health = Math.max(0, this.escort.health - 22);
    this.audio.bump();
    this.particles.emit(this.escort.pilot.pos, 10, 0, 130);
    this.shake = Math.max(this.shake, 7);
  }

  private updateEscort(dt: number): void {
    const e = this.escort;
    e.time += dt;
    e.timeLeft -= dt;
    e.invulnTimer = Math.max(0, e.invulnTimer - dt);
    this.shake *= 0.88;

    if (this.input.consumePress("BracketLeft")) {
      e.fogMultiplier = clamp(e.fogMultiplier - 0.15, 0.5, 2);
    }
    if (this.input.consumePress("BracketRight")) {
      e.fogMultiplier = clamp(e.fogMultiplier + 0.15, 0.5, 2);
    }
    if (this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter")) {
      this.comms.cycleKind();
    }

    const pilotInput = this.input.readPilot();
    e.pilot.vel.x += pilotInput.x * ESCORT_ACCEL * dt;
    e.pilot.vel.y += pilotInput.y * ESCORT_ACCEL * dt;
    const damp = pilotInput.brake ? 0.82 : 0.965;
    e.pilot.vel.x *= damp;
    e.pilot.vel.y *= damp;
    e.pilot.pos.x = clamp(e.pilot.pos.x + e.pilot.vel.x * dt, PILOT_RADIUS, e.worldWidth - PILOT_RADIUS);
    e.pilot.pos.y = clamp(e.pilot.pos.y + e.pilot.vel.y * dt, PILOT_RADIUS, e.worldHeight + 60);

    for (const wall of e.walls) {
      for (const rect of wallRects(wall, e.time, e.worldWidth)) {
        if (rect.x1 <= rect.x0) {
          continue;
        }
        const push = resolveCircleRect(e.pilot.pos, PILOT_RADIUS, rect);
        if (push) {
          e.pilot.pos.x += push.x;
          e.pilot.pos.y += push.y;
          if (Math.abs(push.x) > Math.abs(push.y)) {
            e.pilot.vel.x = 0;
          } else {
            e.pilot.vel.y = 0;
          }
          this.registerHazardHit();
        }
      }
    }

    for (const mine of e.mines) {
      mine.pos.x += mine.vel.x * dt;
      mine.pos.y += mine.vel.y * dt;
      if (mine.pos.x < mine.radius || mine.pos.x > e.worldWidth - mine.radius) {
        mine.vel.x *= -1;
      }
      if (mine.pos.y < mine.roomTop + mine.radius || mine.pos.y > mine.roomBottom - mine.radius) {
        mine.vel.y *= -1;
      }
      mine.pos.x = clamp(mine.pos.x, mine.radius, e.worldWidth - mine.radius);
      mine.pos.y = clamp(mine.pos.y, mine.roomTop + mine.radius, mine.roomBottom - mine.radius);

      const d = dist(e.pilot.pos, mine.pos);
      if (d < PILOT_RADIUS + mine.radius) {
        const n = normalize(sub(e.pilot.pos, mine.pos));
        const overlap = PILOT_RADIUS + mine.radius - d;
        e.pilot.pos.x += n.x * overlap;
        e.pilot.pos.y += n.y * overlap;
        e.pilot.vel.x += n.x * 240;
        e.pilot.vel.y += n.y * 240;
        this.registerHazardHit();
      }
    }

    const navInput = this.input.readNavigator();
    this.comms.update(dt, navInput, e.worldWidth, e.worldHeight);
    if (this.comms.consumeDropped()) {
      this.audio.ping();
    }
    const reached = this.comms.consumeReachedWaypoints(e.pilot.pos, 30);
    if (reached > 0) {
      this.audio.locked();
      const cap = escortWaveConfig(e.wave).timeLimit + 10;
      e.timeLeft = Math.min(e.timeLeft + reached * 2, cap);
      this.particles.emit(e.pilot.pos, 14, 150, 140);
    }

    let nearestMineDist = Infinity;
    for (const mine of e.mines) {
      nearestMineDist = Math.min(nearestMineDist, dist(e.pilot.pos, mine.pos));
    }
    this.audio.setTension(nearestMineDist === Infinity ? 0 : clamp(1 - nearestMineDist / 260, 0, 1));

    this.particles.update(dt);

    if (e.pilot.pos.y >= e.worldHeight - EXIT_MARGIN) {
      this.audio.waveClear();
      this.particles.emit(e.pilot.pos, 24, 140, 180);
      e.baseDepth += e.worldHeight;
      this.loadEscortWave(e.wave + 1);
    } else if (e.health <= 0 || e.timeLeft <= 0) {
      this.audio.gameOver();
      this.phase = "ended";
    }

    e.score = (e.baseDepth + clamp(e.pilot.pos.y, 0, e.worldHeight)) / DEPTH_UNIT;

    this.hud.setHud({
      left: "PILOT",
      center: `Depth ${e.score.toFixed(1)}m  ·  Health ${Math.round(e.health)}%  ·  Time ${Math.max(0, e.timeLeft).toFixed(1)}s`,
      right: `NAVIGATOR · ${this.comms.pendingKind.toUpperCase()}`
    });
  }

  // --- DEFUSE ----------------------------------------------------------

  private resetDefuse(): void {
    this.defuse.wave = 1;
    this.defuse.score = 0;
    this.defuse.strikes = 0;
    this.defuse.manualHighlight = 0;
    this.loadDefusePanel();
  }

  private loadDefusePanel(): void {
    const d = this.defuse;
    d.symbolIdx = Math.floor(Math.random() * DEFUSE_SYMBOLS.length);
    d.buffer = [];
    d.timeLeft = defuseTimeLimit(d.wave);
    d.flash = { kind: null, timer: 0 };
  }

  private commitDefuse(): void {
    const d = this.defuse;
    const correct = DEFUSE_SYMBOLS[d.symbolIdx].sequence;
    const match = correct.length === d.buffer.length && correct.every((dir, i) => dir === d.buffer[i]);
    if (match) {
      d.score += 1;
      d.wave += 1;
      this.audio.correct();
      this.particles.emit(vec(this.canvasSize.width * 0.25, this.canvasSize.height * 0.46), 18, 140, 150);
      d.flash = { kind: "correct", timer: 0.4 };
      this.loadDefusePanel();
    } else {
      this.strikeDefuse();
    }
  }

  private strikeDefuse(): void {
    const d = this.defuse;
    d.strikes += 1;
    this.audio.wrong();
    d.flash = { kind: "wrong", timer: 0.4 };
    this.shake = Math.max(this.shake, 6);
    d.buffer = [];
    if (d.strikes >= 3) {
      this.audio.gameOver();
      this.phase = "ended";
    } else {
      d.timeLeft = Math.max(d.timeLeft, 4);
    }
  }

  private updateDefuse(dt: number): void {
    const d = this.defuse;
    d.timeLeft -= dt;
    d.flash.timer = Math.max(0, d.flash.timer - dt);
    this.shake *= 0.88;

    if (this.input.consumePress("ArrowUp")) {
      d.manualHighlight = Math.max(0, d.manualHighlight - 1);
    }
    if (this.input.consumePress("ArrowDown")) {
      d.manualHighlight = Math.min(DEFUSE_SYMBOLS.length - 1, d.manualHighlight + 1);
    }

    for (const [code, dir] of DIRECTION_KEYS) {
      if (this.input.consumePress(code) && d.buffer.length < 6) {
        d.buffer.push(dir);
      }
    }
    if (this.input.consumePress("Space")) {
      d.buffer = [];
    }
    if (this.input.consumePress("ShiftLeft")) {
      this.commitDefuse();
    }

    if (this.phase === "playing" && d.timeLeft <= 0) {
      this.strikeDefuse();
    }

    this.particles.update(dt);

    this.hud.setHud({
      left: "PILOT",
      center: `Panels ${d.score}  ·  Strikes ${d.strikes}/3  ·  Time ${Math.max(0, d.timeLeft).toFixed(1)}s`,
      right: "NAVIGATOR"
    });
  }

  // --- Frame update ------------------------------------------------------

  update(dt: number): void {
    if (this.phase === "ended" && !this.endHandled) {
      this.beginEndSequence();
    }

    if (this.phase !== "playing" && this.nameEntry?.active) {
      this.updateNameEntry();
      this.applyOverlayHud();
      this.input.endFrame();
      return;
    }

    if (this.phase !== "playing") {
      const global = this.input.consumeGlobal();
      if (this.input.consumePress("Digit1")) this.activeMode = "escort";
      if (this.input.consumePress("Digit2")) this.activeMode = "defuse";
      if (global.startPressed || global.restartPressed) {
        this.audio.initOnGesture();
        this.resetRound();
      }
      this.applyOverlayHud();
      this.input.endFrame();
      return;
    }

    if (this.activeMode === "escort") {
      this.updateEscort(dt);
    } else {
      this.updateDefuse(dt);
    }

    if (this.input.isHeld("KeyH")) {
      this.hud.setOverlay({
        visible: true,
        title: "HOW TO PLAY",
        body: (this.activeMode === "escort" ? ESCORT_HELP : DEFUSE_HELP) + "\n\nRelease H to resume"
      });
    } else {
      this.hud.setOverlay({ visible: false, title: "", body: "" });
    }

    this.input.endFrame();
  }

  // --- Leaderboard / end-of-run ------------------------------------------

  private beginEndSequence(): void {
    this.endHandled = true;
    this.endBoardKey = this.activeMode;
    this.endScore = this.activeMode === "escort" ? this.escort.score : this.defuse.score;
    this.submitState = "idle";
    this.justSubmitted = null;
    this.nameEntry = null;
    this.leaderboardActive = false;
    this.board = [];
    const board = this.endBoardKey;
    getLeaderboard(LEADERBOARD_GAME, board).then((state) => {
      if (this.phase !== "ended" || this.endBoardKey !== board) return;
      if (!state.enabled) return;
      this.leaderboardActive = true;
      this.board = state.entries;
      if (qualifies(state.entries, this.endScore)) {
        this.nameEntry = { active: true, chars: [] };
      }
    });
  }

  private updateNameEntry(): void {
    const ne = this.nameEntry;
    if (!ne) return;
    if (this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter")) {
      if (ne.chars.length >= 1) this.confirmName();
      return;
    }
    if (this.input.consumePress("Backspace")) {
      ne.chars.pop();
      return;
    }
    if (ne.chars.length >= NAME_MAX) return;
    for (let c = 65; c <= 90; c += 1) {
      if (this.input.consumePress(`Key${String.fromCharCode(c)}`)) {
        ne.chars.push(String.fromCharCode(c));
        return;
      }
    }
    for (let d = 0; d <= 9; d += 1) {
      if (this.input.consumePress(`Digit${d}`) || this.input.consumePress(`Numpad${d}`)) {
        ne.chars.push(String(d));
        return;
      }
    }
  }

  private confirmName(): void {
    const ne = this.nameEntry;
    if (!ne) return;
    const name = ne.chars.join("");
    this.nameEntry = null;
    this.submitState = "submitting";
    this.justSubmitted = { name, score: this.endScore };
    this.audio.correct();
    const board = this.endBoardKey;
    submitScore(LEADERBOARD_GAME, board, name, this.endScore).then((res) => {
      if (this.endBoardKey !== board) return;
      if (res) {
        this.board = res.entries;
        this.submitState = "done";
      } else {
        this.submitState = "error";
      }
    });
  }

  private applyOverlayHud(): void {
    const modeLabel = this.activeMode === "escort" ? "ESCORT" : "DEFUSE";
    this.hud.setHud({ left: "RELAY", center: `Mode: ${modeLabel}`, right: "1 Escort · 2 Defuse" });
    if (this.phase === "ended") {
      this.hud.setOverlay({ visible: true, ...this.buildEndOverlay(modeLabel) });
    } else {
      const help = this.activeMode === "escort" ? ESCORT_HELP : DEFUSE_HELP;
      this.hud.setOverlay({
        visible: true,
        title: "RELAY",
        body:
          help +
          `\n\nMode: ${modeLabel}  (press 1 Escort · 2 Defuse)\nEnter to launch  ·  R to restart  ·  Hold H for help`
      });
    }
  }

  private buildEndOverlay(modeLabel: string): { title: string; body: string } {
    const scoreLine =
      this.activeMode === "escort"
        ? `Depth reached: ${this.endScore.toFixed(1)}m`
        : `Panels defused: ${Math.round(this.endScore)}`;
    const header = `${scoreLine}  (${modeLabel})`;
    const footer = "1/2 change mode  ·  Enter or R to play again";

    if (!this.leaderboardActive) {
      return { title: "Run Complete", body: `${header}\n\n${footer}` };
    }

    if (this.nameEntry?.active) {
      const typed = this.nameEntry.chars.join("");
      const cursor = this.nameEntry.chars.length < NAME_MAX ? "_" : "";
      return {
        title: "NEW HIGH SCORE!",
        body:
          `${header}\n\nEnter your initials:\n\n    ${typed}${cursor}\n\n` +
          `Type A–Z / 0–9  ·  Backspace  ·  Enter to save`
      };
    }

    const status =
      this.submitState === "submitting"
        ? "\nSaving…"
        : this.submitState === "error"
          ? "\n(couldn't reach leaderboard — score not saved)"
          : "";
    return {
      title: "Run Complete",
      body: `${header}${status}\n\n${this.formatBoard(modeLabel)}\n\n${footer}`
    };
  }

  private formatBoard(modeLabel: string): string {
    const heading = `— RELAY · ${modeLabel} —`;
    if (this.board.length === 0) {
      return `${heading}\n(no scores yet — be the first!)`;
    }
    const rows = this.board.slice(0, 10).map((entry, i) => {
      const mine =
        this.justSubmitted !== null &&
        entry.name === this.justSubmitted.name &&
        Math.abs(entry.score - this.justSubmitted.score) < 0.05;
      const marker = mine ? "▶ " : "  ";
      const rank = String(i + 1).padStart(2, " ");
      const name = entry.name.padEnd(NAME_MAX, " ");
      const score =
        this.activeMode === "escort"
          ? `${entry.score.toFixed(1)}m`.padStart(7, " ")
          : `${Math.round(entry.score)}`.padStart(4, " ");
      return `${marker}${rank}. ${name} ${score}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  }

  // --- Render --------------------------------------------------------------

  render(_alpha: number): void {
    const { ctx } = this;
    const jitterX = (Math.random() - 0.5) * this.shake;
    const jitterY = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.fillStyle = "#05060d";
    ctx.fillRect(0, 0, this.canvasSize.width, this.canvasSize.height);
    ctx.translate(jitterX, jitterY);

    if (this.activeMode === "escort") {
      this.renderEscort();
    } else {
      this.renderDefuse();
    }

    ctx.restore();
  }

  private escortViewport(): { scale: number; offsetX: number; offsetY: number } {
    const e = this.escort;
    const scale = Math.min(this.canvasSize.width / e.worldWidth, this.canvasSize.height / e.worldHeight);
    const offsetX = (this.canvasSize.width - e.worldWidth * scale) / 2;
    const offsetY = (this.canvasSize.height - e.worldHeight * scale) / 2;
    return { scale, offsetX, offsetY };
  }

  private drawEscortWorld(ctx: CanvasRenderingContext2D, bright: boolean): void {
    const e = this.escort;
    if (bright) {
      ctx.fillStyle = "rgba(10,16,34,0.4)";
      ctx.fillRect(0, 0, e.worldWidth, e.worldHeight);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, e.worldHeight);
      g.addColorStop(0, "#0b1024");
      g.addColorStop(1, "#04050f");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, e.worldWidth, e.worldHeight);
    }

    for (const wall of e.walls) {
      for (const rect of wallRects(wall, e.time, e.worldWidth)) {
        if (rect.x1 <= rect.x0) continue;
        ctx.fillStyle = bright ? "rgba(150,180,255,0.85)" : "rgba(110,130,180,0.28)";
        ctx.fillRect(rect.x0, rect.y0, rect.x1 - rect.x0, rect.y1 - rect.y0);
      }
      if (wall.isGate) {
        const open = isGateOpen(wall, e.time);
        const gapL = wall.gapX - wall.gapWidth / 2;
        const gapR = wall.gapX + wall.gapWidth / 2;
        const openColor = bright ? "rgba(120,255,180,0.9)" : "rgba(90,180,140,0.4)";
        const closedColor = bright ? "rgba(255,120,120,0.9)" : "rgba(180,90,90,0.4)";
        ctx.strokeStyle = open ? openColor : closedColor;
        ctx.lineWidth = 3;
        ctx.strokeRect(gapL, wall.y - WALL_THICKNESS / 2, gapR - gapL, WALL_THICKNESS);
      }
    }

    for (const mine of e.mines) {
      const pulse = 0.8 + Math.sin(e.time * 4 + mine.pos.x) * 0.2;
      ctx.fillStyle = bright ? "rgba(255,90,120,0.32)" : "rgba(255,90,120,0.16)";
      ctx.beginPath();
      ctx.arc(mine.pos.x, mine.pos.y, mine.radius * 1.8 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = bright ? "rgba(255,140,150,0.95)" : "rgba(255,90,120,0.3)";
      ctx.beginPath();
      ctx.arc(mine.pos.x, mine.pos.y, mine.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const exitY = e.worldHeight - 6;
    ctx.fillStyle = bright ? "rgba(120,255,190,0.9)" : "rgba(90,200,150,0.3)";
    ctx.fillRect(0, exitY, e.worldWidth, 6);
  }

  private drawPingsAndCursor(ctx: CanvasRenderingContext2D): void {
    const cursor = this.comms.cursor;
    ctx.save();
    ctx.strokeStyle = "rgba(120,220,255,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursor.x - 10, cursor.y);
    ctx.lineTo(cursor.x + 10, cursor.y);
    ctx.moveTo(cursor.x, cursor.y - 10);
    ctx.lineTo(cursor.x, cursor.y + 10);
    ctx.stroke();
    ctx.restore();

    for (const ping of this.comms.all()) {
      const t = ping.age / 6.5;
      const pulse = 0.5 + Math.sin(ping.age * 6) * 0.5;
      const alpha = Math.max(0, 1 - t);
      const color =
        ping.kind === "waypoint"
          ? `rgba(120,220,255,${alpha})`
          : ping.kind === "danger"
            ? `rgba(255,110,110,${alpha})`
            : `rgba(255,220,110,${alpha})`;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(ping.pos.x, ping.pos.y, 10 + pulse * 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      const glyph = ping.kind === "waypoint" ? "▸" : ping.kind === "danger" ? "!" : "…";
      ctx.fillText(glyph, ping.pos.x, ping.pos.y + 5);
      ctx.restore();
    }
  }

  private drawPilotAvatar(ctx: CanvasRenderingContext2D): void {
    const pos = this.escort.pilot.pos;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "rgba(255,160,90,0.28)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, PILOT_RADIUS * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,180,110,0.95)";
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, PILOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private renderEscort(): void {
    const { ctx } = this;
    const e = this.escort;
    const { scale, offsetX, offsetY } = this.escortViewport();

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    this.drawEscortWorld(ctx, false);
    ctx.restore();

    const radiusPx = e.baseFogRadius * e.fogMultiplier * scale;
    const centerPx = vec(offsetX + e.pilot.pos.x * scale, offsetY + e.pilot.pos.y * scale);
    const scratch = this.fog.render(this.canvasSize.width, this.canvasSize.height, radiusPx, centerPx, (sctx) => {
      sctx.translate(offsetX, offsetY);
      sctx.scale(scale, scale);
      this.drawEscortWorld(sctx, true);
    });
    ctx.drawImage(scratch, 0, 0);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);
    this.drawPingsAndCursor(ctx);
    this.drawPilotAvatar(ctx);
    this.particles.render(ctx);
    ctx.restore();
  }

  private renderDefuse(): void {
    const { ctx } = this;
    const d = this.defuse;
    const w = this.canvasSize.width;
    const h = this.canvasSize.height;
    const midX = w / 2;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b0a14");
    bg.addColorStop(1, "#04040a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = "rgba(255,140,80,0.08)";
    ctx.fillRect(0, 0, midX, h);
    ctx.fillStyle = "rgba(90,170,255,0.08)";
    ctx.fillRect(midX, 0, w - midX, h);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, h);
    ctx.stroke();

    if (d.flash.kind) {
      const alpha = (d.flash.timer / 0.4) * 0.25;
      ctx.fillStyle = d.flash.kind === "correct" ? `rgba(120,255,170,${alpha})` : `rgba(255,90,90,${alpha})`;
      ctx.fillRect(0, 0, w, h);
    }

    const symbol = DEFUSE_SYMBOLS[d.symbolIdx];
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,200,160,0.95)";
    ctx.font = `${Math.min(midX, h) * 0.32}px sans-serif`;
    ctx.fillText(symbol.glyph, midX * 0.5, h * 0.46);

    ctx.font = "28px sans-serif";
    ctx.fillStyle = "rgba(255,230,200,0.9)";
    const bufferText = d.buffer.map((dir) => DIRECTION_ARROW[dir]).join(" ") || "—";
    ctx.fillText(bufferText, midX * 0.5, h * 0.62);

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "rgba(255,200,160,0.6)";
    ctx.fillText("WASD enter · Left Shift commit · Space clear", midX * 0.5, h * 0.7);

    const barW = midX * 0.6;
    const barX = midX * 0.5 - barW / 2;
    const barY = h * 0.78;
    const frac = Math.max(0, d.timeLeft / defuseTimeLimit(d.wave));
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = frac > 0.3 ? "rgba(255,180,110,0.9)" : "rgba(255,90,90,0.9)";
    ctx.fillRect(barX, barY, barW * frac, 10);

    ctx.textAlign = "left";
    const manualX = midX + 40;
    const rowH = Math.min(46, (h - 80) / DEFUSE_SYMBOLS.length);
    ctx.font = "13px sans-serif";
    ctx.fillStyle = "rgba(170,210,255,0.7)";
    ctx.fillText("NAVIGATOR MANUAL", manualX, 36);
    DEFUSE_SYMBOLS.forEach((sym, i) => {
      const y = 60 + i * rowH;
      if (i === d.manualHighlight) {
        ctx.fillStyle = "rgba(120,180,255,0.12)";
        ctx.fillRect(midX + 16, y - rowH * 0.35, w - midX - 32, rowH * 0.9);
      }
      ctx.font = "22px sans-serif";
      ctx.fillStyle = "rgba(200,225,255,0.95)";
      ctx.fillText(sym.glyph, manualX, y + 8);
      ctx.font = "18px sans-serif";
      ctx.fillStyle = "rgba(170,210,255,0.85)";
      ctx.fillText(sym.sequence.map((dir) => DIRECTION_ARROW[dir]).join(" "), manualX + 50, y + 8);
    });

    this.particles.render(ctx);
  }
}
