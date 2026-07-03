import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { Hud } from "./ui";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

const HELP_BODY =
  "MAGNETIC DUEL — herd the shared charged core into your rival's gate.\n" +
  "The gate is the glowing zone on your opponent's side. First to 5 wins.\n\n" +
  "How magnetism works:\n" +
  "· The core carries a charge (+ or -). So do you.\n" +
  "· OPPOSITE charges ATTRACT — the core swings toward you.\n" +
  "· LIKE charges REPEL — the core is pushed away.\n" +
  "· Flip your polarity to pull the core in, then shove it at their gate.\n\n" +
  "Abilities:\n" +
  "· DASH lunges you and briefly GRABS the core toward you (short cooldown).\n" +
  "· BURST fires a shockwave that knocks the core and your rival away.\n\n" +
  "P1  ·  W A S D move  ·  Left Shift flip  ·  Space dash  ·  E burst\n" +
  "P2  ·  Arrows move  ·  Right Shift flip  ·  Enter dash  ·  . burst\n\n" +
  "Any time  ·  [ ] adjust field strength (weaker / stronger forces)";

type Player = {
  pos: Vec;
  vel: Vec;
  polarity: 1 | -1;
  hue: number;
  score: number;
  dashCooldown: number;
  grabTimer: number;
  burstCooldown: number;
};

type Ball = {
  pos: Vec;
  vel: Vec;
  polarity: 1 | -1;
};

type Shockwave = {
  pos: Vec;
  radius: number;
  life: number;
  hue: number;
};

type GameMode = "intro" | "playing" | "ended";

const BALL_MAGNETISM = 500000;
const PP_MAGNETISM = 175000;
const FIELD_MIN = 0.4;
const FIELD_MAX = 2.5;
const FIELD_STEP = 0.2;
const DASH_COOLDOWN = 1.2;
const DASH_GRAB_TIME = 0.35;
const DASH_GRAB_MULT = 3.4;
const BURST_COOLDOWN = 4;
const BURST_RADIUS = 260;
const BURST_BALL_IMPULSE = 640;
const BURST_PLAYER_IMPULSE = 480;

export class PolarityGame {
  private mode: GameMode = "intro";
  private world = { width: 1280, height: 720 };
  private shake = 0;
  private timeLeft = 90;
  private readonly winScore = 5;
  private readonly goalWidth = 72;
  private readonly particles = new ParticleSystem();
  private readonly trail: Vec[] = [];
  private readonly shockwaves: Shockwave[] = [];
  private fieldStrength = 1;

  private readonly players: [Player, Player] = [
    {
      pos: vec(240, 360),
      vel: vec(),
      polarity: 1,
      hue: 210,
      score: 0,
      dashCooldown: 0,
      grabTimer: 0,
      burstCooldown: 0
    },
    {
      pos: vec(1040, 360),
      vel: vec(),
      polarity: -1,
      hue: 16,
      score: 0,
      dashCooldown: 0,
      grabTimer: 0,
      burstCooldown: 0
    }
  ];

  private ball: Ball = {
    pos: vec(640, 360),
    vel: vec(),
    polarity: 1
  };

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
    this.timeLeft = 90;
    this.shake = 0;
    this.players[0] = {
      pos: vec(this.world.width * 0.2, this.world.height * 0.5),
      vel: vec(),
      polarity: 1,
      hue: 210,
      score: 0,
      dashCooldown: 0,
      grabTimer: 0,
      burstCooldown: 0
    };
    this.players[1] = {
      pos: vec(this.world.width * 0.8, this.world.height * 0.5),
      vel: vec(),
      polarity: -1,
      hue: 16,
      score: 0,
      dashCooldown: 0,
      grabTimer: 0,
      burstCooldown: 0
    };
    this.ball = {
      pos: vec(this.world.width * 0.5, this.world.height * 0.5),
      vel: vec(),
      polarity: 1
    };
    this.trail.length = 0;
    this.shockwaves.length = 0;
  }

  private adjustFieldStrength(delta: number): void {
    this.fieldStrength = clamp(this.fieldStrength + delta, FIELD_MIN, FIELD_MAX);
  }

  private fieldLabel(): string {
    return `Field ${this.fieldStrength.toFixed(1)}×`;
  }

  update(dt: number): void {
    const global = this.input.consumeGlobal();
    if (this.input.consumePress("BracketLeft")) {
      this.adjustFieldStrength(-FIELD_STEP);
    }
    if (this.input.consumePress("BracketRight")) {
      this.adjustFieldStrength(FIELD_STEP);
    }
    if (this.mode !== "playing" && (global.startPressed || global.restartPressed)) {
      this.audio.initOnGesture();
      this.resetRound();
    }

    if (this.mode !== "playing") {
      this.hud.setHud({
        left: "POLARITY",
        center: `${this.fieldLabel()}  ·  [ ] adjust`,
        right: "First to 5"
      });
      this.hud.setOverlay({
        visible: true,
        title: this.mode === "ended" ? "Match Complete" : "POLARITY",
        body:
          this.mode === "ended"
            ? `P1 ${this.players[0].score} - ${this.players[1].score} P2\n` +
              `${this.fieldLabel()}  ·  [ ] adjust field strength\n` +
              "Press Enter or R for rematch"
            : HELP_BODY + "\n\nEnter to start  ·  R to restart  ·  Hold H for help"
      });
      this.input.endFrame();
      return;
    }

    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this.updatePlayers(dt);
    this.applyMagnetics(dt);
    this.integrateBall(dt);
    this.checkGoals();
    this.particles.update(dt);
    this.updateShockwaves(dt);

    this.trail.push(vec(this.ball.pos.x, this.ball.pos.y));
    if (this.trail.length > 24) {
      this.trail.shift();
    }

    this.shake *= 0.9;
    if (
      this.timeLeft <= 0 ||
      this.players[0].score >= this.winScore ||
      this.players[1].score >= this.winScore
    ) {
      this.mode = "ended";
      this.audio.score();
    }

    const p1Polarity = this.players[0].polarity > 0 ? "POS+" : "NEG-";
    const p2Polarity = this.players[1].polarity > 0 ? "POS+" : "NEG-";
    this.hud.setHud({
      left: `P1 ${this.players[0].score} (${p1Polarity})`,
      center: `Time ${this.timeLeft.toFixed(0)}s  ·  ${this.fieldLabel()}`,
      right: `P2 ${this.players[1].score} (${p2Polarity})`
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

  private updatePlayers(dt: number): void {
    const p1In = this.input.readPlayerOne();
    const p2In = this.input.readPlayerTwo();
    const accel = 540;

    const p1 = this.players[0];
    const p2 = this.players[1];
    p1.vel.x += p1In.x * accel * dt;
    p1.vel.y += p1In.y * accel * dt;
    p2.vel.x += p2In.x * accel * dt;
    p2.vel.y += p2In.y * accel * dt;

    if (this.input.consumePress("ShiftLeft")) {
      p1.polarity = p1.polarity === 1 ? -1 : 1;
      this.audio.polarityFlip();
    }
    if (this.input.consumePress("ShiftRight") || this.input.consumePress("Slash")) {
      p2.polarity = p2.polarity === 1 ? -1 : 1;
      this.audio.polarityFlip();
    }

    for (const player of this.players) {
      player.dashCooldown = Math.max(0, player.dashCooldown - dt);
      player.grabTimer = Math.max(0, player.grabTimer - dt);
      player.burstCooldown = Math.max(0, player.burstCooldown - dt);
    }

    if (this.input.consumePress("Space") && p1.dashCooldown <= 0) {
      this.performDash(p1, vec(p1In.x || Math.sign(p1.vel.x) || 1, p1In.y || 0));
    }
    if (
      (this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter")) &&
      p2.dashCooldown <= 0
    ) {
      this.performDash(p2, vec(p2In.x || Math.sign(p2.vel.x) || -1, p2In.y || 0));
    }

    if (this.input.consumePress("KeyE") && p1.burstCooldown <= 0) {
      this.performBurst(p1, this.players[1]);
    }
    if (this.input.consumePress("Period") && p2.burstCooldown <= 0) {
      this.performBurst(p2, this.players[0]);
    }

    for (const player of this.players) {
      player.vel.x *= 0.985;
      player.vel.y *= 0.985;
      player.pos.x += player.vel.x * dt;
      player.pos.y += player.vel.y * dt;
      const margin = 18;
      player.pos.x = clamp(player.pos.x, margin, this.world.width - margin);
      player.pos.y = clamp(player.pos.y, margin, this.world.height - margin);
    }
  }

  private performDash(player: Player, aim: Vec): void {
    const direction = normalize(aim);
    player.vel.x += direction.x * 380;
    player.vel.y += direction.y * 380;
    player.dashCooldown = DASH_COOLDOWN;
    player.grabTimer = DASH_GRAB_TIME;
    this.particles.emit(player.pos, 10, player.hue, 180);
    this.audio.dash();
  }

  private performBurst(player: Player, rival: Player): void {
    player.burstCooldown = BURST_COOLDOWN;
    const strength = this.fieldStrength;

    const shove = (target: { pos: Vec; vel: Vec }, impulse: number): void => {
      const delta = sub(target.pos, player.pos);
      const d = len(delta);
      if (d > BURST_RADIUS) {
        return;
      }
      const dir = d < 1 ? vec(0, -1) : { x: delta.x / d, y: delta.y / d };
      const falloff = 1 - d / BURST_RADIUS;
      target.vel.x += dir.x * impulse * falloff * strength;
      target.vel.y += dir.y * impulse * falloff * strength;
    };

    shove(this.ball, BURST_BALL_IMPULSE);
    shove(rival, BURST_PLAYER_IMPULSE);

    this.shockwaves.push({
      pos: vec(player.pos.x, player.pos.y),
      radius: 0,
      life: 1,
      hue: player.hue
    });
    this.particles.emit(player.pos, 20, player.hue, 240);
    this.shake = Math.max(this.shake, 8);
    this.audio.burst();
  }

  private updateShockwaves(dt: number): void {
    for (let i = this.shockwaves.length - 1; i >= 0; i -= 1) {
      const wave = this.shockwaves[i];
      wave.life -= dt * 2.4;
      wave.radius = BURST_RADIUS * (1 - wave.life);
      if (wave.life <= 0) {
        this.shockwaves.splice(i, 1);
      }
    }
  }

  private applyMagnetics(dt: number): void {
    for (const player of this.players) {
      const delta = sub(this.ball.pos, player.pos);
      const d = Math.max(28, len(delta));
      const dir = { x: delta.x / d, y: delta.y / d };
      const magnetic = (BALL_MAGNETISM * this.fieldStrength) / (d * d);
      // dir points player -> ball, so +scalar repels and -scalar attracts.
      let scalar: number;
      if (player.grabTimer > 0) {
        // Dash grab: pull the core hard toward the player regardless of polarity.
        scalar = -magnetic * DASH_GRAB_MULT;
      } else {
        const sign = player.polarity * this.ball.polarity;
        scalar = sign > 0 ? magnetic : -magnetic;
      }
      this.ball.vel.x += dir.x * scalar * dt;
      this.ball.vel.y += dir.y * scalar * dt;
      player.vel.x -= dir.x * scalar * dt * 0.16;
      player.vel.y -= dir.y * scalar * dt * 0.16;
    }

    const p1 = this.players[0];
    const p2 = this.players[1];
    const delta = sub(p2.pos, p1.pos);
    const d = Math.max(36, len(delta));
    const dir = { x: delta.x / d, y: delta.y / d };
    const magnetic = (PP_MAGNETISM * this.fieldStrength) / (d * d);
    const sign = p1.polarity * p2.polarity;
    const scalar = sign > 0 ? magnetic : -magnetic;
    p1.vel.x -= dir.x * scalar * dt;
    p1.vel.y -= dir.y * scalar * dt;
    p2.vel.x += dir.x * scalar * dt;
    p2.vel.y += dir.y * scalar * dt;
  }

  private integrateBall(dt: number): void {
    this.ball.vel.x *= 0.997;
    this.ball.vel.y *= 0.997;

    const maxSpeed = 900;
    const speed = len(this.ball.vel);
    if (speed > maxSpeed) {
      const s = maxSpeed / speed;
      this.ball.vel.x *= s;
      this.ball.vel.y *= s;
    }

    this.ball.pos.x += this.ball.vel.x * dt;
    this.ball.pos.y += this.ball.vel.y * dt;

    const radius = 12;
    if (this.ball.pos.y < radius || this.ball.pos.y > this.world.height - radius) {
      this.ball.vel.y *= -1;
      this.ball.pos.y = clamp(this.ball.pos.y, radius, this.world.height - radius);
    }

    const onGoalLane =
      this.ball.pos.y > this.world.height * 0.28 && this.ball.pos.y < this.world.height * 0.72;
    if (
      this.ball.pos.x < this.goalWidth + radius &&
      !onGoalLane &&
      this.ball.vel.x < 0
    ) {
      this.ball.vel.x *= -1;
      this.ball.pos.x = this.goalWidth + radius;
    }
    if (
      this.ball.pos.x > this.world.width - this.goalWidth - radius &&
      !onGoalLane &&
      this.ball.vel.x > 0
    ) {
      this.ball.vel.x *= -1;
      this.ball.pos.x = this.world.width - this.goalWidth - radius;
    }
  }

  private checkGoals(): void {
    const inGoalLane =
      this.ball.pos.y > this.world.height * 0.28 && this.ball.pos.y < this.world.height * 0.72;
    if (!inGoalLane) {
      return;
    }
    if (this.ball.pos.x < this.goalWidth) {
      this.players[1].score += 1;
      this.onScore(1);
    } else if (this.ball.pos.x > this.world.width - this.goalWidth) {
      this.players[0].score += 1;
      this.onScore(0);
    }
  }

  private onScore(scoredBy: 0 | 1): void {
    const hue = scoredBy === 0 ? 210 : 16;
    this.audio.score();
    this.particles.emit(this.ball.pos, 36, hue, 220);
    this.shake = 12;
    this.ball.pos = vec(this.world.width * 0.5, this.world.height * 0.5);
    this.ball.vel = vec((Math.random() - 0.5) * 180, (Math.random() - 0.5) * 180);
    this.ball.polarity = this.ball.polarity === 1 ? -1 : 1;
    this.trail.length = 0;
  }

  render(_alpha: number): void {
    const jx = (Math.random() - 0.5) * this.shake;
    const jy = (Math.random() - 0.5) * this.shake;
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, jx, jy);
    this.drawBackground();
    this.drawGoals();
    this.drawFieldLines();
    this.drawTrail();
    this.drawShockwaves();
    this.drawPlayers();
    this.drawBall();
    this.particles.render(this.ctx);
    this.ctx.restore();
  }

  private drawShockwaves(): void {
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    for (const wave of this.shockwaves) {
      this.ctx.strokeStyle = `hsla(${wave.hue}, 100%, 70%, ${wave.life * 0.8})`;
      this.ctx.lineWidth = 2 + wave.life * 6;
      this.ctx.beginPath();
      this.ctx.arc(wave.pos.x, wave.pos.y, wave.radius, 0, Math.PI * 2);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawBackground(): void {
    const g = this.ctx.createLinearGradient(0, 0, 0, this.world.height);
    g.addColorStop(0, "#130322");
    g.addColorStop(1, "#06010d");
    this.ctx.fillStyle = g;
    this.ctx.fillRect(0, 0, this.world.width, this.world.height);

    this.ctx.strokeStyle = "rgba(175, 143, 255, 0.14)";
    this.ctx.lineWidth = 1;
    for (let y = 24; y < this.world.height; y += 40) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y);
      this.ctx.lineTo(this.world.width, y);
      this.ctx.stroke();
    }
  }

  private drawGoals(): void {
    const top = this.world.height * 0.28;
    const height = this.world.height * 0.44;
    this.ctx.fillStyle = "rgba(69, 189, 255, 0.2)";
    this.ctx.fillRect(0, top, this.goalWidth, height);
    this.ctx.fillStyle = "rgba(255, 124, 86, 0.2)";
    this.ctx.fillRect(this.world.width - this.goalWidth, top, this.goalWidth, height);
  }

  private drawFieldLines(): void {
    for (const player of this.players) {
      const attraction = player.polarity * this.ball.polarity < 0;
      this.ctx.save();
      this.ctx.strokeStyle = attraction ? "rgba(164,255,231,0.4)" : "rgba(255,164,246,0.3)";
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      this.ctx.moveTo(player.pos.x, player.pos.y);
      this.ctx.lineTo(this.ball.pos.x, this.ball.pos.y);
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawTrail(): void {
    if (this.trail.length < 2) {
      return;
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    for (let i = 1; i < this.trail.length; i += 1) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const t = i / this.trail.length;
      this.ctx.strokeStyle = `rgba(255,255,255,${t * 0.5})`;
      this.ctx.lineWidth = 1 + t * 3;
      this.ctx.beginPath();
      this.ctx.moveTo(a.x, a.y);
      this.ctx.lineTo(b.x, b.y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  private drawPlayers(): void {
    for (const player of this.players) {
      const positive = player.polarity > 0;
      const color = positive ? "rgba(72, 176, 255, 0.95)" : "rgba(255, 120, 86, 0.95)";
      this.ctx.save();
      this.ctx.globalCompositeOperation = "lighter";

      // Grab window flare — the dash scoop is active.
      if (player.grabTimer > 0) {
        const t = player.grabTimer / DASH_GRAB_TIME;
        this.ctx.strokeStyle = `hsla(${player.hue}, 100%, 75%, ${t})`;
        this.ctx.lineWidth = 3;
        this.ctx.beginPath();
        this.ctx.arc(player.pos.x, player.pos.y, 20 + (1 - t) * 16, 0, Math.PI * 2);
        this.ctx.stroke();
      }

      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 20;
      this.ctx.beginPath();
      this.ctx.arc(player.pos.x, player.pos.y, 14, 0, Math.PI * 2);
      this.ctx.fill();

      // Burst charge ring: fills clockwise as the ability recharges.
      const ready = player.burstCooldown <= 0;
      const frac = ready ? 1 : 1 - player.burstCooldown / BURST_COOLDOWN;
      this.ctx.shadowBlur = 0;
      this.ctx.strokeStyle = ready
        ? `hsla(${player.hue}, 100%, 80%, 0.95)`
        : `hsla(${player.hue}, 80%, 60%, 0.4)`;
      this.ctx.lineWidth = ready ? 3 : 2;
      this.ctx.beginPath();
      this.ctx.arc(
        player.pos.x,
        player.pos.y,
        20,
        -Math.PI / 2,
        -Math.PI / 2 + Math.PI * 2 * frac
      );
      this.ctx.stroke();
      this.ctx.restore();
    }
  }

  private drawBall(): void {
    const positive = this.ball.polarity > 0;
    const color = positive ? "rgba(180, 232, 255, 1)" : "rgba(255, 196, 174, 1)";
    this.ctx.save();
    this.ctx.globalCompositeOperation = "lighter";
    this.ctx.fillStyle = color;
    this.ctx.shadowColor = color;
    this.ctx.shadowBlur = 28;
    this.ctx.beginPath();
    this.ctx.arc(this.ball.pos.x, this.ball.pos.y, 12, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }
}
