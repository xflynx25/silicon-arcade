import type { PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const WIN_SCORE = 5;
const PADDLE_LEN = 90;
const PADDLE_THICK = 10;
const BALL_R = 8;
const WALL_PAD = 48;
const GOAL_DEPTH = 28;

type Paddle = {
  y: number;
  angle: number;
  smash: number;
  spinReady: boolean;
  hue: number;
  side: "left" | "right";
};

type Ball = {
  pos: Vec;
  vel: Vec;
  spin: number;
  rally: number;
};

type TrailPoint = { x: number; y: number; age: number };

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  update: (dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: () => { title: string; body: string; visible: boolean };
};

const paddleEndpoints = (
  paddle: Paddle,
  wallX: number,
  smashOffset: number
): { a: Vec; b: Vec } => {
  const outward = paddle.side === "left" ? 1 : -1;
  const cx = wallX + outward * smashOffset;
  const half = PADDLE_LEN * 0.5;
  const dx = Math.cos(paddle.angle) * half * outward;
  const dy = Math.sin(paddle.angle) * half;
  return {
    a: vec(cx - dx, paddle.y - dy),
    b: vec(cx + dx, paddle.y + dy)
  };
};

const reflectBallOffSegment = (
  ball: Ball,
  a: Vec,
  b: Vec,
  smash: number,
  spinReady: boolean,
  audio: AudioSystem,
  particles: ParticleSystem
): boolean => {
  const ab = sub(b, a);
  const abLen = len(ab);
  if (abLen < 0.001) {
    return false;
  }
  const abNorm = normalize(ab);
  const ap = sub(ball.pos, a);
  const t = clamp(ap.x * abNorm.x + ap.y * abNorm.y, 0, abLen);
  const closest = vec(a.x + abNorm.x * t, a.y + abNorm.y * t);
  const d = dist(ball.pos, closest);
  if (d > BALL_R + PADDLE_THICK) {
    return false;
  }

  const normal = normalize(sub(ball.pos, closest));
  const speed = len(ball.vel);
  const boost = 1 + smash * 0.35 + ball.rally * 0.02;
  const reflected = vec(
    ball.vel.x - 2 * (ball.vel.x * normal.x + ball.vel.y * normal.y) * normal.x,
    ball.vel.y - 2 * (ball.vel.x * normal.x + ball.vel.y * normal.y) * normal.y
  );
  const paddleInfluence = vec(-abNorm.y * ball.spin * 80, abNorm.x * ball.spin * 80);
  ball.vel = normalize(reflected);
  ball.vel.x *= speed * boost + paddleInfluence.x * 0.01;
  ball.vel.y *= speed * boost + paddleInfluence.y * 0.01;
  ball.vel = normalize(ball.vel);
  const newSpeed = clamp(speed * boost + 40, 220, 720);
  ball.vel.x *= newSpeed;
  ball.vel.y *= newSpeed;
  ball.rally += 1;
  ball.pos.x = closest.x + normal.x * (BALL_R + 2);
  ball.pos.y = closest.y + normal.y * (BALL_R + 2);

  if (smash > 0) {
    audio.smash();
    particles.emit(closest, 16, 55, 180);
  } else if (spinReady) {
    audio.spin();
    ball.spin = clamp(ball.spin + (Math.random() > 0.5 ? 1 : -1) * 1.2, -3, 3);
    particles.emit(closest, 10, 200, 140);
  } else {
    audio.bounce();
    particles.emit(closest, 8, 180, 100);
  }
  return true;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let scoreP1 = 0;
  let scoreP2 = 0;
  let roundTimer = 0;
  let shake = 0;
  let winner: 1 | 2 | null = null;
  const particles = new ParticleSystem();
  const trails: TrailPoint[] = [];

  const p1: Paddle = { y: h * 0.5, angle: 0, smash: 0, spinReady: false, hue: 190, side: "left" };
  const p2: Paddle = { y: h * 0.5, angle: 0, smash: 0, spinReady: false, hue: 320, side: "right" };

  const ball: Ball = {
    pos: vec(w * 0.5, h * 0.5),
    vel: vec(280, 120),
    spin: 0,
    rally: 0
  };

  const resetBall = (toward: 1 | 2): void => {
    ball.pos = vec(w * 0.5, h * 0.5);
    ball.spin = 0;
    ball.rally = 0;
    const dir = toward === 1 ? -1 : 1;
    ball.vel = vec(dir * 280, (Math.random() - 0.5) * 160);
  };

  const resetPaddles = (): void => {
    p1.y = h * 0.5;
    p2.y = h * 0.5;
    p1.angle = 0;
    p2.angle = 0;
    p1.smash = 0;
    p2.smash = 0;
    p1.spinReady = false;
    p2.spinReady = false;
  };

  const updatePaddle = (
    paddle: Paddle,
    input: PlayerInput,
    slideAxis: number,
    tiltAxis: number,
    dt: number
  ): void => {
    const minY = WALL_PAD + PADDLE_LEN * 0.5;
    const maxY = h - WALL_PAD - PADDLE_LEN * 0.5;
    paddle.y = clamp(paddle.y + slideAxis * 420 * dt, minY, maxY);
    paddle.angle = clamp(paddle.angle + tiltAxis * 2.8 * dt, -0.85, 0.85);

    if (input.primary) {
      paddle.smash = clamp(paddle.smash + 4 * dt, 0, 1);
    } else {
      paddle.smash = Math.max(0, paddle.smash - 6 * dt);
    }

    if (input.secondary && !paddle.spinReady) {
      paddle.spinReady = true;
    }
  };

  const scoreGoal = (scorer: 1 | 2, audio: AudioSystem): void => {
    if (scorer === 1) {
      scoreP1 += 1;
    } else {
      scoreP2 += 1;
    }
    audio.score();
    shake = 12;
    particles.emit(ball.pos, 40, scorer === 1 ? 190 : 320, 220);
    winner = scoreP1 >= WIN_SCORE ? 1 : scoreP2 >= WIN_SCORE ? 2 : null;
    phase = winner !== null ? "matchEnd" : "roundEnd";
    roundTimer = 1.2;
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      resetPaddles();
      ball.pos = vec(w * 0.5, h * 0.5);
    },

    startRound(): void {
      phase = "playing";
      scoreP1 = 0;
      scoreP2 = 0;
      winner = null;
      resetPaddles();
      resetBall(Math.random() > 0.5 ? 1 : 2);
    },

    restartRound(): void {
      phase = "playing";
      scoreP1 = 0;
      scoreP2 = 0;
      winner = null;
      resetPaddles();
      resetBall(Math.random() > 0.5 ? 1 : 2);
    },

    update(dt: number, p1In: PlayerInput, p2In: PlayerInput, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 28);

      if (phase === "roundEnd" || phase === "matchEnd") {
        roundTimer -= dt;
        if (roundTimer <= 0 && phase === "roundEnd") {
          phase = "playing";
          resetPaddles();
          resetBall(scoreP1 > scoreP2 ? 2 : 1);
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      updatePaddle(p1, p1In, p1In.y, p1In.x, dt);
      updatePaddle(p2, p2In, p2In.y, p2In.x, dt);

      ball.spin *= 0.998;
      ball.vel.x += ball.spin * ball.vel.y * 0.0008;
      ball.pos.x += ball.vel.x * dt;
      ball.pos.y += ball.vel.y * dt;

      trails.push({ x: ball.pos.x, y: ball.pos.y, age: 0.35 });
      for (let i = trails.length - 1; i >= 0; i -= 1) {
        trails[i].age -= dt;
        if (trails[i].age <= 0) {
          trails.splice(i, 1);
        }
      }

      const top = WALL_PAD;
      const bottom = h - WALL_PAD;
      if (ball.pos.y - BALL_R < top) {
        ball.pos.y = top + BALL_R;
        ball.vel.y = Math.abs(ball.vel.y);
        audio.bounce();
      }
      if (ball.pos.y + BALL_R > bottom) {
        ball.pos.y = bottom - BALL_R;
        ball.vel.y = -Math.abs(ball.vel.y);
        audio.bounce();
      }

      const leftWall = WALL_PAD;
      const rightWall = w - WALL_PAD;

      if (ball.pos.x - BALL_R < leftWall - GOAL_DEPTH) {
        scoreGoal(2, audio);
        return;
      }
      if (ball.pos.x + BALL_R > rightWall + GOAL_DEPTH) {
        scoreGoal(1, audio);
        return;
      }

      const p1Seg = paddleEndpoints(p1, leftWall, p1.smash * 22);
      const p2Seg = paddleEndpoints(p2, rightWall, p2.smash * 22);

      if (reflectBallOffSegment(ball, p1Seg.a, p1Seg.b, p1.smash, p1.spinReady, audio, particles)) {
        p1.spinReady = false;
      }
      if (reflectBallOffSegment(ball, p2Seg.a, p2Seg.b, p2.smash, p2.spinReady, audio, particles)) {
        p2.spinReady = false;
      }

      if (ball.pos.x - BALL_R < leftWall && ball.vel.x < 0) {
        ball.pos.x = leftWall + BALL_R;
        ball.vel.x = Math.abs(ball.vel.x);
      }
      if (ball.pos.x + BALL_R > rightWall && ball.vel.x > 0) {
        ball.pos.x = rightWall - BALL_R;
        ball.vel.x = -Math.abs(ball.vel.x);
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      ctx.fillStyle = "#050a14";
      ctx.fillRect(0, 0, rw, rh);

      ctx.strokeStyle = "rgba(0, 180, 255, 0.08)";
      ctx.lineWidth = 1;
      for (let x = 0; x < rw; x += 40) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, rh);
        ctx.stroke();
      }
      for (let y = 0; y < rh; y += 40) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(rw, y);
        ctx.stroke();
      }

      const top = WALL_PAD;
      const bottom = rh - WALL_PAD;
      const leftWall = WALL_PAD;
      const rightWall = rw - WALL_PAD;

      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(leftWall, top);
      ctx.lineTo(leftWall, bottom);
      ctx.moveTo(rightWall, top);
      ctx.lineTo(rightWall, bottom);
      ctx.stroke();

      ctx.fillStyle = "rgba(255, 60, 100, 0.25)";
      ctx.fillRect(0, top, leftWall - GOAL_DEPTH, bottom - top);
      ctx.fillStyle = "rgba(60, 200, 255, 0.25)";
      ctx.fillRect(rightWall + GOAL_DEPTH, top, rw - rightWall - GOAL_DEPTH, bottom - top);

      const drawPaddle = (paddle: Paddle, wallX: number): void => {
        const seg = paddleEndpoints(paddle, wallX, paddle.smash * 22);
        ctx.save();
        ctx.strokeStyle = `hsl(${paddle.hue}, 100%, 60%)`;
        ctx.shadowColor = `hsl(${paddle.hue}, 100%, 50%)`;
        ctx.shadowBlur = 14 + paddle.smash * 20;
        ctx.lineWidth = PADDLE_THICK;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(seg.a.x, seg.a.y);
        ctx.lineTo(seg.b.x, seg.b.y);
        ctx.stroke();
        if (paddle.spinReady) {
          ctx.globalCompositeOperation = "lighter";
          ctx.strokeStyle = `hsla(${paddle.hue}, 100%, 80%, 0.6)`;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
        ctx.restore();
      };

      drawPaddle(p1, leftWall);
      drawPaddle(p2, rightWall);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const t of trails) {
        const a = t.age / 0.35;
        ctx.fillStyle = `hsla(180, 100%, 70%, ${a * 0.5})`;
        ctx.beginPath();
        ctx.arc(t.x, t.y, BALL_R * a * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      const speed = len(ball.vel);
      const glow = clamp((speed - 200) / 400, 0.3, 1);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = `hsla(55, 100%, 70%, ${glow})`;
      ctx.shadowColor = `hsla(55, 100%, 60%, ${glow})`;
      ctx.shadowBlur = 18 + ball.rally * 2;
      ctx.beginPath();
      ctx.arc(ball.pos.x, ball.pos.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      return {
        left: `P1 ${scoreP1}`,
        center: phase === "playing" ? `Rally ${ball.rally}` : phase === "roundEnd" ? "GOAL!" : "",
        right: `P2 ${scoreP2}`
      };
    },

    getOverlay(): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        return {
          title: "RICOCHET",
          body:
            "Tilt paddles (A/D · ←/→), slide (W/S · ↑/↓).\n" +
            "Shift = smash lunge · Space/Enter = curve spin.\n\n" +
            "First to 5 wins. Press Enter to start.",
          visible: true
        };
      }
      if (phase === "matchEnd" && winner !== null) {
        return {
          title: `PLAYER ${winner} WINS`,
          body: `Final score ${scoreP1} — ${scoreP2}\nPress R to restart.`,
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
