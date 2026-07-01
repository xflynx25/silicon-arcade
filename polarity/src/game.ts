import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { Hud } from "./ui";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

const HELP_BODY =
  "Magnetic duel — bend the shared charged core\n" +
  "into your rival's gate. First to 5 wins.\n\n" +
  "P1  ·  W A S D move  ·  Left Shift flip polarity  ·  Space dash\n" +
  "P2  ·  Arrow keys move  ·  Right Shift flip  ·  Enter dash";

type Player = {
  pos: Vec;
  vel: Vec;
  polarity: 1 | -1;
  hue: number;
  score: number;
  dashCooldown: number;
};

type Ball = {
  pos: Vec;
  vel: Vec;
  polarity: 1 | -1;
};

type GameMode = "intro" | "playing" | "ended";

export class PolarityGame {
  private mode: GameMode = "intro";
  private world = { width: 1280, height: 720 };
  private shake = 0;
  private timeLeft = 90;
  private readonly winScore = 5;
  private readonly goalWidth = 72;
  private readonly particles = new ParticleSystem();
  private readonly trail: Vec[] = [];

  private readonly players: [Player, Player] = [
    {
      pos: vec(240, 360),
      vel: vec(),
      polarity: 1,
      hue: 210,
      score: 0,
      dashCooldown: 0
    },
    {
      pos: vec(1040, 360),
      vel: vec(),
      polarity: -1,
      hue: 16,
      score: 0,
      dashCooldown: 0
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
      dashCooldown: 0
    };
    this.players[1] = {
      pos: vec(this.world.width * 0.8, this.world.height * 0.5),
      vel: vec(),
      polarity: -1,
      hue: 16,
      score: 0,
      dashCooldown: 0
    };
    this.ball = {
      pos: vec(this.world.width * 0.5, this.world.height * 0.5),
      vel: vec(),
      polarity: 1
    };
    this.trail.length = 0;
  }

  update(dt: number): void {
    const global = this.input.consumeGlobal();
    if (this.mode !== "playing" && (global.startPressed || global.restartPressed)) {
      this.audio.initOnGesture();
      this.resetRound();
    }

    if (this.mode !== "playing") {
      this.hud.setHud({
        left: "POLARITY",
        center: "Press Enter to start",
        right: "First to 5"
      });
      this.hud.setOverlay({
        visible: true,
        title: this.mode === "ended" ? "Match Complete" : "POLARITY",
        body:
          this.mode === "ended"
            ? `P1 ${this.players[0].score} - ${this.players[1].score} P2\nPress Enter or R for rematch`
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
      center: `Time ${this.timeLeft.toFixed(0)}s`,
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

    p1.dashCooldown = Math.max(0, p1.dashCooldown - dt);
    p2.dashCooldown = Math.max(0, p2.dashCooldown - dt);

    if (this.input.consumePress("Space") && p1.dashCooldown <= 0) {
      const direction = normalize(vec(p1In.x || Math.sign(p1.vel.x) || 1, p1In.y || 0));
      p1.vel.x += direction.x * 380;
      p1.vel.y += direction.y * 380;
      p1.dashCooldown = 1.2;
      this.particles.emit(p1.pos, 10, 215, 180);
      this.audio.dash();
    }
    if (
      (this.input.consumePress("Enter") || this.input.consumePress("NumpadEnter")) &&
      p2.dashCooldown <= 0
    ) {
      const direction = normalize(vec(p2In.x || Math.sign(p2.vel.x) || -1, p2In.y || 0));
      p2.vel.x += direction.x * 380;
      p2.vel.y += direction.y * 380;
      p2.dashCooldown = 1.2;
      this.particles.emit(p2.pos, 10, 18, 180);
      this.audio.dash();
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

  private applyMagnetics(dt: number): void {
    for (const player of this.players) {
      const delta = sub(this.ball.pos, player.pos);
      const d = Math.max(28, len(delta));
      const dir = { x: delta.x / d, y: delta.y / d };
      const magnetic = 500000 / (d * d);
      const sign = player.polarity * this.ball.polarity;
      const scalar = sign > 0 ? magnetic : -magnetic;
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
    const magnetic = 175000 / (d * d);
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
    this.drawPlayers();
    this.drawBall();
    this.particles.render(this.ctx);
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
      this.ctx.fillStyle = color;
      this.ctx.shadowColor = color;
      this.ctx.shadowBlur = 20;
      this.ctx.beginPath();
      this.ctx.arc(player.pos.x, player.pos.y, 14, 0, Math.PI * 2);
      this.ctx.fill();
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
