import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { Hud } from "./ui";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";
import {
  getLeaderboard,
  qualifies,
  submitScore,
  type LeaderboardEntry
} from "./leaderboard";

// TETHER leaderboard metric = seconds survived, one board per difficulty.
const LEADERBOARD_GAME = "tether";
const NAME_MAX = 8;

type NameEntry = { active: boolean; chars: string[] };
type SubmitState = "idle" | "submitting" | "done" | "error";

const HELP_BODY =
  "Co-op — two spirits bound by an elastic tether.\n" +
  "You slowly SWELL over time — a bigger, easier target.\n" +
  "Eat light to shrink back down. Touch a void and your\n" +
  "health bleeds slowly — grab a prism together to stop it.\n\n" +
  "P1  ·  W A S D move  ·  Left Shift reel tether\n" +
  "P2  ·  Arrow keys move  ·  Right Shift reel tether";

const BLEED_RATE = 3.5;

type Difficulty = "easy" | "normal" | "hard";

type DifficultyConfig = {
  label: string;
  hazardSize: number;
  hazardSpeed: number;
  hazardCount: number;
  growth: number;
  drain: number;
};

const DIFFICULTIES: Record<Difficulty, DifficultyConfig> = {
  easy: { label: "Easy", hazardSize: 0.85, hazardSpeed: 0.8, hazardCount: 0.7, growth: 0.65, drain: 0.75 },
  normal: { label: "Normal", hazardSize: 1, hazardSpeed: 1, hazardCount: 1, growth: 1, drain: 1 },
  hard: { label: "Hard", hazardSize: 1.4, hazardSpeed: 1.45, hazardCount: 1.6, growth: 1.55, drain: 1.35 }
};

const BASE_RADIUS = 13;
const MIN_RADIUS = 10;
const MAX_RADIUS = 46;

type Player = {
  pos: Vec;
  vel: Vec;
  hue: number;
  score: number;
  radius: number;
  trail: Vec[];
};

type Orb = {
  pos: Vec;
  vel: Vec;
  radius: number;
  hue: number;
  kind: "light" | "prism";
  touchP1At: number | null;
  touchP2At: number | null;
};

type Hazard = {
  pos: Vec;
  vel: Vec;
  radius: number;
  entered: boolean;
};

type GameMode = "intro" | "playing" | "ended";

export class TetherGame {
  private mode: GameMode = "intro";
  private world = { width: 1280, height: 720 };
  private time = 0;
  private elapsed = 0;
  private wave = 1;
  private spawnTimer = 0;
  private prismTimer = 5;
  private hazardTimer = 0;
  private health = 100;
  private bleeding = false;
  private shake = 0;
  private restLength = 170;
  private difficulty: Difficulty = "normal";
  private readonly players: [Player, Player] = [
    { pos: vec(520, 360), vel: vec(0, 0), hue: 186, score: 0, radius: BASE_RADIUS, trail: [] },
    { pos: vec(760, 360), vel: vec(0, 0), hue: 328, score: 0, radius: BASE_RADIUS, trail: [] }
  ];
  private readonly orbs: Orb[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly particles = new ParticleSystem();

  // Leaderboard / end-of-run state.
  private endHandled = false;
  private endScore = 0;
  private endBoardKey: Difficulty = "normal";
  private board: LeaderboardEntry[] = [];
  // True only once the endpoint confirms a leaderboard is configured; when
  // false the end screen shows no leaderboard UI at all.
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
    this.world.width = width;
    this.world.height = height;
  }

  private resetRound(): void {
    this.mode = "playing";
    this.endHandled = false;
    this.leaderboardActive = false;
    this.nameEntry = null;
    this.submitState = "idle";
    this.justSubmitted = null;
    this.time = 0;
    this.elapsed = 0;
    this.wave = 1;
    this.spawnTimer = 0.2;
    this.prismTimer = 4;
    this.hazardTimer = 1.5;
    this.health = 100;
    this.bleeding = false;
    this.shake = 0;
    this.restLength = 170;
    this.orbs.length = 0;
    this.hazards.length = 0;
    this.particles.clear();
    this.players[0] = { pos: vec(this.world.width * 0.42, this.world.height * 0.5), vel: vec(), hue: 186, score: 0, radius: BASE_RADIUS, trail: [] };
    this.players[1] = { pos: vec(this.world.width * 0.58, this.world.height * 0.5), vel: vec(), hue: 328, score: 0, radius: BASE_RADIUS, trail: [] };
  }

  update(dt: number): void {
    // Kick off the end-of-run leaderboard flow exactly once.
    if (this.mode === "ended" && !this.endHandled) {
      this.beginEndSequence();
    }

    // While typing initials, letters/digits/Enter belong to name entry, so we
    // must NOT let consumeGlobal() eat Enter/R first.
    if (this.mode !== "playing" && this.nameEntry?.active) {
      this.updateNameEntry();
      this.applyMenuHud();
      this.input.endFrame();
      return;
    }

    const global = this.input.consumeGlobal();
    if (this.mode !== "playing") {
      if (this.input.consumePress("Digit1")) this.difficulty = "easy";
      if (this.input.consumePress("Digit2")) this.difficulty = "normal";
      if (this.input.consumePress("Digit3")) this.difficulty = "hard";
      if (global.startPressed || global.restartPressed) {
        this.audio.initOnGesture();
        this.resetRound();
      }
      this.applyMenuHud();
      this.input.endFrame();
      return;
    }

    const cfg = DIFFICULTIES[this.difficulty];
    this.elapsed += dt;
    this.time += dt;
    this.wave = 1 + Math.floor(this.time / 25);
    if (this.bleeding) {
      this.health = Math.max(0, this.health - dt * BLEED_RATE * cfg.drain);
    }

    // Spirits swell as the run goes on — a bigger, easier target. Eating light
    // is the only way to shrink back down. Growth accelerates with the wave.
    const growth = (2.6 + this.wave * 0.5) * cfg.growth;
    for (const player of this.players) {
      player.radius = Math.min(MAX_RADIUS, player.radius + growth * dt);
    }

    const p1Input = this.input.readPlayerOne();
    const p2Input = this.input.readPlayerTwo();
    const thrust = 520;
    this.players[0].vel.x += p1Input.x * thrust * dt;
    this.players[0].vel.y += p1Input.y * thrust * dt;
    this.players[1].vel.x += p2Input.x * thrust * dt;
    this.players[1].vel.y += p2Input.y * thrust * dt;

    const reeling = p1Input.primary || p2Input.primary;
    const targetRest = reeling ? 95 : 170;
    this.restLength += (targetRest - this.restLength) * Math.min(1, dt * 7);

    this.applyTether(dt);
    this.integratePlayers(dt);
    this.spawnAndUpdateOrbs(dt);
    this.spawnAndUpdateHazards(dt);
    this.checkPlayerOrbInteractions();
    this.checkPlayerHazards(dt);
    this.particles.update(dt);

    this.shake *= 0.88;
    if (this.health <= 0) {
      this.mode = "ended";
      this.audio.danger();
    }

    const bleedLabel = this.bleeding ? " · Bleeding" : "";
    this.hud.setHud({
      left: `P1 ${this.players[0].score}`,
      center: `Health ${this.health.toFixed(0)}%${bleedLabel} | Wave ${this.wave} | ${DIFFICULTIES[this.difficulty].label}`,
      right: `P2 ${this.players[1].score}`
    });
    if (this.input.isHeld("KeyH")) {
      this.hud.setOverlay({
        visible: true,
        title: "HOW TO PLAY",
        body: HELP_BODY + "\n\nRelease H to resume"
      });
    } else {
      this.hud.setOverlay({ visible: false, title: "", body: "" });
    }
    this.input.endFrame();
  }

  // --- Leaderboard / end-of-run ------------------------------------------

  private beginEndSequence(): void {
    this.endHandled = true;
    this.endScore = this.time;
    this.endBoardKey = this.difficulty;
    this.submitState = "idle";
    this.justSubmitted = null;
    this.nameEntry = null;
    this.leaderboardActive = false;
    this.board = [];
    const board = this.difficulty;
    getLeaderboard(LEADERBOARD_GAME, board).then((state) => {
      // Drop the result if the player already restarted or switched difficulty.
      if (this.mode !== "ended" || this.endBoardKey !== board) return;
      // No leaderboard configured (or unreachable): show none of its UI.
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
    this.audio.collect();
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

  private applyMenuHud(): void {
    const diffLabel = DIFFICULTIES[this.difficulty].label;
    this.hud.setHud({ left: "TETHER", center: `Difficulty: ${diffLabel}`, right: "WASD + Arrows" });
    if (this.mode === "ended") {
      this.hud.setOverlay({ visible: true, ...this.buildEndOverlay(diffLabel) });
    } else {
      this.hud.setOverlay({
        visible: true,
        title: "TETHER",
        body:
          HELP_BODY +
          `\n\nDifficulty: ${diffLabel}  (press 1 Easy · 2 Normal · 3 Hard)\nEnter to launch  ·  R to restart  ·  Hold H for help`
      });
    }
  }

  private buildEndOverlay(diffLabel: string): { title: string; body: string } {
    const header =
      `Survived ${this.endScore.toFixed(1)}s on ${diffLabel}\n` +
      `P1 Light ${this.players[0].score} | P2 Light ${this.players[1].score}`;
    const footer = "1/2/3 change difficulty  ·  Enter or R to play again";

    // No leaderboard configured/reachable (or still loading): the plain, original
    // Run Complete screen — the game is fully playable with zero leaderboard UI.
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
      body: `${header}${status}\n\n${this.formatBoard(diffLabel)}\n\n${footer}`
    };
  }

  private formatBoard(diffLabel: string): string {
    const heading = `— TETHER · ${diffLabel} —`;
    if (this.board.length === 0) {
      return `${heading}\n(no scores yet — be the first!)`;
    }
    const rows = this.board.slice(0, 10).map((e, i) => {
      const mine =
        this.justSubmitted !== null &&
        e.name === this.justSubmitted.name &&
        Math.abs(e.score - this.justSubmitted.score) < 0.05;
      const marker = mine ? "▶ " : "  ";
      const rank = String(i + 1).padStart(2, " ");
      const name = e.name.padEnd(NAME_MAX, " ");
      const score = `${e.score.toFixed(1)}s`.padStart(7, " ");
      return `${marker}${rank}. ${name} ${score}`;
    });
    return `${heading}\n${rows.join("\n")}`;
  }

  private applyTether(dt: number): void {
    const p1 = this.players[0];
    const p2 = this.players[1];
    const delta = sub(p2.pos, p1.pos);
    const d = Math.max(len(delta), 0.0001);
    const dir = { x: delta.x / d, y: delta.y / d };
    const relVel = (p2.vel.x - p1.vel.x) * dir.x + (p2.vel.y - p1.vel.y) * dir.y;
    const springK = 24;
    const damping = 8;
    const stretch = d - this.restLength;
    const force = springK * stretch + damping * relVel;
    p1.vel.x += dir.x * force * dt;
    p1.vel.y += dir.y * force * dt;
    p2.vel.x -= dir.x * force * dt;
    p2.vel.y -= dir.y * force * dt;

    const maxLength = 350;
    if (d > maxLength) {
      const overflow = d - maxLength;
      p1.pos.x += dir.x * overflow * 0.5;
      p1.pos.y += dir.y * overflow * 0.5;
      p2.pos.x -= dir.x * overflow * 0.5;
      p2.pos.y -= dir.y * overflow * 0.5;
      p1.vel.x += dir.x * overflow * dt * 20;
      p2.vel.x -= dir.x * overflow * dt * 20;
    }
  }

  private integratePlayers(dt: number): void {
    for (const player of this.players) {
      player.vel.x *= 0.985;
      player.vel.y *= 0.985;
      player.pos.x += player.vel.x * dt;
      player.pos.y += player.vel.y * dt;
      const pad = 18;
      if (player.pos.x < pad || player.pos.x > this.world.width - pad) {
        player.vel.x *= -0.5;
      }
      if (player.pos.y < pad || player.pos.y > this.world.height - pad) {
        player.vel.y *= -0.5;
      }
      player.pos.x = clamp(player.pos.x, pad, this.world.width - pad);
      player.pos.y = clamp(player.pos.y, pad, this.world.height - pad);
      player.trail.push(vec(player.pos.x, player.pos.y));
      if (player.trail.length > 16) {
        player.trail.shift();
      }
    }
  }

  private spawnAndUpdateOrbs(dt: number): void {
    this.spawnTimer -= dt;
    this.prismTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = Math.max(0.35, 1.2 - this.wave * 0.08);
      this.orbs.push({
        pos: vec(Math.random() * (this.world.width - 80) + 40, Math.random() * (this.world.height - 80) + 40),
        vel: vec((Math.random() - 0.5) * 35, (Math.random() - 0.5) * 35),
        radius: 9,
        hue: 62 + Math.random() * 20,
        kind: "light",
        touchP1At: null,
        touchP2At: null
      });
    }
    if (this.prismTimer <= 0) {
      this.prismTimer = 7.5;
      this.orbs.push({
        pos: vec(Math.random() * (this.world.width - 120) + 60, Math.random() * (this.world.height - 120) + 60),
        vel: vec((Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20),
        radius: 13,
        hue: 280 + Math.random() * 40,
        kind: "prism",
        touchP1At: null,
        touchP2At: null
      });
    }

    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      orb.pos.x += orb.vel.x * dt;
      orb.pos.y += orb.vel.y * dt;
      if (orb.pos.x < 10 || orb.pos.x > this.world.width - 10) {
        orb.vel.x *= -1;
      }
      if (orb.pos.y < 10 || orb.pos.y > this.world.height - 10) {
        orb.vel.y *= -1;
      }
      if (
        orb.touchP1At !== null &&
        orb.touchP2At !== null &&
        Math.abs(orb.touchP1At - orb.touchP2At) <= 0.7
      ) {
        this.players[0].score += 3;
        this.players[1].score += 3;
        // A shared prism shrinks both spirits — a big reprieve for teamwork.
        this.players[0].radius = Math.max(MIN_RADIUS, this.players[0].radius - 7);
        this.players[1].radius = Math.max(MIN_RADIUS, this.players[1].radius - 7);
        this.bleeding = false;
        this.audio.collect();
        this.particles.emit(orb.pos, 18, orb.hue, 160);
        this.orbs.splice(i, 1);
      }
    }
  }

  private spawnAndUpdateHazards(dt: number): void {
    const cfg = DIFFICULTIES[this.difficulty];
    this.hazardTimer -= dt;
    const maxHazards = Math.round((4 + this.wave * 1.5) * cfg.hazardCount);
    if (this.hazardTimer <= 0 && this.hazards.length < maxHazards) {
      this.hazardTimer = Math.max(0.7, (2.6 - this.wave * 0.18) / cfg.hazardCount);
      const speed = (110 + this.wave * 20) * cfg.hazardSpeed;
      const radius = (30 + Math.random() * 22 + this.wave * 2) * cfg.hazardSize;
      const side = Math.floor(Math.random() * 4);
      const margin = radius + 10;
      let pos: Vec;
      let vel: Vec;
      const along = (Math.random() - 0.5) * speed;
      const inward = speed * (0.5 + Math.random() * 0.5);
      if (side === 0) {
        pos = vec(Math.random() * this.world.width, -margin);
        vel = vec(along, inward);
      } else if (side === 1) {
        pos = vec(this.world.width + margin, Math.random() * this.world.height);
        vel = vec(-inward, along);
      } else if (side === 2) {
        pos = vec(Math.random() * this.world.width, this.world.height + margin);
        vel = vec(along, -inward);
      } else {
        pos = vec(-margin, Math.random() * this.world.height);
        vel = vec(inward, along);
      }
      this.hazards.push({ pos, vel, radius, entered: false });
    }

    for (const hazard of this.hazards) {
      hazard.pos.x += hazard.vel.x * dt;
      hazard.pos.y += hazard.vel.y * dt;
      if (
        !hazard.entered &&
        hazard.pos.x >= hazard.radius &&
        hazard.pos.x <= this.world.width - hazard.radius &&
        hazard.pos.y >= hazard.radius &&
        hazard.pos.y <= this.world.height - hazard.radius
      ) {
        hazard.entered = true;
      }
      if (!hazard.entered) {
        continue;
      }
      if (hazard.pos.x < hazard.radius || hazard.pos.x > this.world.width - hazard.radius) {
        hazard.vel.x *= -1;
      }
      if (hazard.pos.y < hazard.radius || hazard.pos.y > this.world.height - hazard.radius) {
        hazard.vel.y *= -1;
      }
      hazard.pos.x = clamp(hazard.pos.x, hazard.radius, this.world.width - hazard.radius);
      hazard.pos.y = clamp(hazard.pos.y, hazard.radius, this.world.height - hazard.radius);
    }
  }

  private checkPlayerOrbInteractions(): void {
    const now = this.elapsed;
    for (let i = this.orbs.length - 1; i >= 0; i -= 1) {
      const orb = this.orbs[i];
      const d1 = dist(orb.pos, this.players[0].pos);
      const d2 = dist(orb.pos, this.players[1].pos);

      if (orb.kind === "light") {
        if (d1 < orb.radius + this.players[0].radius) {
          this.eatLight(this.players[0], orb);
          this.orbs.splice(i, 1);
          continue;
        }
        if (d2 < orb.radius + this.players[1].radius) {
          this.eatLight(this.players[1], orb);
          this.orbs.splice(i, 1);
        }
      } else {
        if (d1 < orb.radius + this.players[0].radius) {
          orb.touchP1At = now;
        }
        if (d2 < orb.radius + this.players[1].radius) {
          orb.touchP2At = now;
        }
        if (
          (orb.touchP1At !== null && now - orb.touchP1At > 0.75) ||
          (orb.touchP2At !== null && now - orb.touchP2At > 0.75)
        ) {
          orb.touchP1At = null;
          orb.touchP2At = null;
        }
      }
    }
  }

  private eatLight(player: Player, orb: Orb): void {
    player.score += 1;
    // Eating light is how you shed size and stay a small, hard target.
    player.radius = Math.max(MIN_RADIUS, player.radius - 4);
    this.particles.emit(orb.pos, 10, orb.hue, 140);
    this.audio.collect();
  }

  private checkPlayerHazards(dt: number): void {
    for (const hazard of this.hazards) {
      for (const player of this.players) {
        const d = dist(hazard.pos, player.pos);
        const touch = hazard.radius + player.radius;
        if (d < touch) {
          const push = normalize(sub(player.pos, hazard.pos));
          player.vel.x += push.x * 320 * dt;
          player.vel.y += push.y * 320 * dt;
          this.bleeding = true;
          this.shake = Math.max(this.shake, 7);
          this.particles.emit(player.pos, 6, 0, 120);
          this.audio.danger();
        }
      }
    }
  }

  render(_alpha: number): void {
    const { ctx } = this;
    const jitterX = (Math.random() - 0.5) * this.shake;
    const jitterY = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(jitterX, jitterY);

    this.drawBackground();
    this.drawOrbs();
    this.drawHazards();
    this.drawTether();
    this.drawTrails();
    this.drawPlayers();
    this.particles.render(ctx);

    ctx.restore();
  }

  private drawBackground(): void {
    const { ctx } = this;
    const g = ctx.createLinearGradient(0, 0, 0, this.world.height);
    g.addColorStop(0, "#070b22");
    g.addColorStop(1, "#03040f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.world.width, this.world.height);

    const t = this.time;
    ctx.strokeStyle = "rgba(120,160,255,0.08)";
    ctx.lineWidth = 1;
    for (let x = 0; x < this.world.width; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin((x + t * 35) * 0.02) * 4, 0);
      ctx.lineTo(x, this.world.height);
      ctx.stroke();
    }
  }

  private drawTrails(): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const player of this.players) {
      const n = player.trail.length;
      const trailScale = player.radius * 0.85;
      for (let i = 0; i < n; i += 1) {
        const t = (i + 1) / n;
        const p = player.trail[i];
        ctx.fillStyle = `hsla(${player.hue}, 100%, 62%, ${t * 0.4})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, trailScale * t, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPlayers(): void {
    const { ctx } = this;
    for (const player of this.players) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsl(${player.hue} 100% 60%)`;
      ctx.shadowColor = `hsl(${player.hue} 100% 65%)`;
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, player.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawTether(): void {
    const { ctx } = this;
    const a = this.players[0].pos;
    const b = this.players[1].pos;
    const mid = vec((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    const d = dist(a, b);
    const n = normalize(sub(b, a));
    const perp = vec(-n.y, n.x);
    const sag = clamp((d - this.restLength) * 0.35, -14, 28);
    const cp = vec(mid.x + perp.x * sag, mid.y + perp.y * sag);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(114, 247, 255, 0.95)";
    ctx.shadowColor = "rgba(114, 247, 255, 1)";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cp.x, cp.y, b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawOrbs(): void {
    const { ctx } = this;
    for (const orb of this.orbs) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(${orb.hue}, 100%, 65%, 0.95)`;
      ctx.shadowColor = `hsla(${orb.hue}, 100%, 65%, 1)`;
      ctx.shadowBlur = orb.kind === "prism" ? 24 : 16;
      ctx.beginPath();
      ctx.arc(orb.pos.x, orb.pos.y, orb.radius, 0, Math.PI * 2);
      ctx.fill();
      if (orb.kind === "prism") {
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(orb.pos.x, orb.pos.y, orb.radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawHazards(): void {
    const { ctx } = this;
    for (const hazard of this.hazards) {
      ctx.save();
      ctx.fillStyle = "rgba(255, 90, 130, 0.24)";
      ctx.strokeStyle = "rgba(255, 120, 160, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hazard.pos.x, hazard.pos.y, hazard.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }
}
