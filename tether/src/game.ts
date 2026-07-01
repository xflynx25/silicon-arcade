import { AudioSystem } from "./audio";
import { InputManager } from "./input";
import { ParticleSystem } from "./particles";
import { Hud } from "./ui";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

type Player = {
  pos: Vec;
  vel: Vec;
  hue: number;
  score: number;
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
  private stability = 100;
  private shake = 0;
  private restLength = 170;
  private readonly players: [Player, Player] = [
    { pos: vec(520, 360), vel: vec(0, 0), hue: 186, score: 0 },
    { pos: vec(760, 360), vel: vec(0, 0), hue: 328, score: 0 }
  ];
  private readonly orbs: Orb[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly particles = new ParticleSystem();

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
    this.time = 0;
    this.elapsed = 0;
    this.wave = 1;
    this.spawnTimer = 0.2;
    this.prismTimer = 4;
    this.hazardTimer = 1.5;
    this.stability = 100;
    this.shake = 0;
    this.restLength = 170;
    this.orbs.length = 0;
    this.hazards.length = 0;
    this.players[0] = { pos: vec(this.world.width * 0.42, this.world.height * 0.5), vel: vec(), hue: 186, score: 0 };
    this.players[1] = { pos: vec(this.world.width * 0.58, this.world.height * 0.5), vel: vec(), hue: 328, score: 0 };
  }

  update(dt: number): void {
    const global = this.input.consumeGlobal();
    if (this.mode !== "playing" && (global.startPressed || global.restartPressed)) {
      this.audio.initOnGesture();
      this.resetRound();
    }

    if (this.mode !== "playing") {
      this.hud.setHud({
        left: "TETHER",
        center: "Press Enter to launch",
        right: "WASD + Arrows"
      });
      this.hud.setOverlay({
        visible: true,
        title: this.mode === "ended" ? "Run Complete" : "TETHER",
        body:
          this.mode === "ended"
            ? `Survived ${this.time.toFixed(1)}s\nP1 Light ${this.players[0].score} | P2 Light ${this.players[1].score}\nPress Enter or R to play again`
            : "Two spirits are bound by light.\nReel the tether with Shift to sling each other.\nCollect light, sync prism pickups, dodge voids."
      });
      this.input.endFrame();
      return;
    }

    this.elapsed += dt;
    this.time += dt;
    this.wave = 1 + Math.floor(this.time / 25);
    this.stability = Math.max(0, this.stability - dt * (1.5 + this.wave * 0.12));

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
    if (this.stability <= 0) {
      this.mode = "ended";
      this.audio.danger();
    }

    this.hud.setHud({
      left: `P1 ${this.players[0].score}`,
      center: `Stability ${this.stability.toFixed(0)}% | Wave ${this.wave}`,
      right: `P2 ${this.players[1].score}`
    });
    this.hud.setOverlay({ visible: false, title: "", body: "" });
    this.input.endFrame();
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
        this.audio.collect();
        this.particles.emit(orb.pos, 24, orb.hue, 160);
        this.orbs.splice(i, 1);
      }
    }
  }

  private spawnAndUpdateHazards(dt: number): void {
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0 && this.hazards.length < 3 + this.wave) {
      this.hazardTimer = Math.max(1.3, 3.4 - this.wave * 0.17);
      this.hazards.push({
        pos: vec(Math.random() * this.world.width, Math.random() * this.world.height),
        vel: vec((Math.random() - 0.5) * (70 + this.wave * 14), (Math.random() - 0.5) * (70 + this.wave * 14)),
        radius: 22 + Math.random() * 16
      });
    }

    for (const hazard of this.hazards) {
      hazard.pos.x += hazard.vel.x * dt;
      hazard.pos.y += hazard.vel.y * dt;
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
        if (d1 < orb.radius + 15) {
          this.players[0].score += 1;
          this.particles.emit(orb.pos, 14, orb.hue, 140);
          this.audio.collect();
          this.orbs.splice(i, 1);
          continue;
        }
        if (d2 < orb.radius + 15) {
          this.players[1].score += 1;
          this.particles.emit(orb.pos, 14, orb.hue, 140);
          this.audio.collect();
          this.orbs.splice(i, 1);
        }
      } else {
        if (d1 < orb.radius + 16) {
          orb.touchP1At = now;
        }
        if (d2 < orb.radius + 16) {
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

  private checkPlayerHazards(dt: number): void {
    for (const hazard of this.hazards) {
      for (const player of this.players) {
        const d = dist(hazard.pos, player.pos);
        const touch = hazard.radius + 14;
        if (d < touch) {
          const push = normalize(sub(player.pos, hazard.pos));
          player.vel.x += push.x * 320 * dt;
          player.vel.y += push.y * 320 * dt;
          this.stability = Math.max(0, this.stability - dt * 28);
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
    ctx.setTransform(1, 0, 0, 1, jitterX, jitterY);

    this.drawBackground();
    this.drawOrbs();
    this.drawHazards();
    this.drawTether();
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

  private drawPlayers(): void {
    const { ctx } = this;
    for (const player of this.players) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsl(${player.hue} 100% 60%)`;
      ctx.shadowColor = `hsl(${player.hue} 100% 65%)`;
      ctx.shadowBlur = 24;
      ctx.beginPath();
      ctx.arc(player.pos.x, player.pos.y, 13, 0, Math.PI * 2);
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
