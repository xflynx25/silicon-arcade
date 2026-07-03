import { vec, type Vec } from "./vec";

type Particle = {
  pos: Vec;
  vel: Vec;
  life: number;
  maxLife: number;
  size: number;
  hue: number;
};

const MAX_PARTICLES = 320;

export class ParticleSystem {
  private readonly pool: Particle[] = [];

  clear(): void {
    this.pool.length = 0;
  }

  emit(position: Vec, count: number, hue: number, speed = 120): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const magnitude = speed * (0.35 + Math.random() * 0.75);
      const life = 0.2 + Math.random() * 0.8;
      this.pool.push({
        pos: vec(position.x, position.y),
        vel: vec(Math.cos(angle) * magnitude, Math.sin(angle) * magnitude),
        life,
        maxLife: life,
        size: 1 + Math.random() * 3,
        hue
      });
    }
    if (this.pool.length > MAX_PARTICLES) {
      this.pool.splice(0, this.pool.length - MAX_PARTICLES);
    }
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i -= 1) {
      const p = this.pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.pool.splice(i, 1);
        continue;
      }
      p.vel.x *= 0.98;
      p.vel.y *= 0.98;
      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // No per-particle shadowBlur — setting it on every dot is a canvas hot spot.
    for (const p of this.pool) {
      const t = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${t})`;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
