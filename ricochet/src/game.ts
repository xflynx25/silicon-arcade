import type { PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import {
  controlsHelp,
  DEFAULT_GOAL_SETTINGS,
  disappearJumpLabel,
  DISAPPEAR_LABELS,
  DISAPPEAR_STEPS,
  DISAPPEAR_VISIBLE_FRAC,
  GOAL_COUNT_LABELS,
  GOAL_COUNT_STEPS,
  GOAL_DRIFT_LABELS,
  GOAL_DRIFT_STEPS,
  GOAL_SIZE_LABELS,
  GOAL_SIZE_STEPS,
  MODE_DESCRIPTION,
  MODE_HELP,
  MODE_LABEL,
  MOVE_RANGE_LABELS,
  MOVE_RANGE_STEPS,
  WIN_SCORE_OPTIONS,
  type ModeId,
  type SettingKind
} from "./modes";
import { clamp, dist, len, normalize, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const PADDLE_LEN = 90;
const PADDLE_THICK = 10;
const BALL_R = 8;
const WALL_PAD = 48;
const GOAL_DEPTH = 44;
const PADDLE_MAX_ANGLE = 1.5;
const PADDLE_TILT_SPEED = 4.5;
const PADDLE_SLIDE_SPEED = 380;
const MIN_HORIZONTAL_FRAC = 0.34;

type Paddle = {
  y: number;
  slideX: number;
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

type Goal = {
  side: "left" | "right";
  y: number;
  h: number;
  vy: number;
  disappearPeriod: number; // full vanish/reappear cycle, seconds; 0 = always on
  t: number;
  visible: boolean;
};

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  selectMode: (mode: ModeId) => void;
  cycleWinScore: (delta: number) => void;
  adjustSetting: (kind: SettingKind, delta: number) => void;
  toggleDisappearJump: () => void;
  toggleFreeMove: () => void;
  toggleUncappedSpeed: () => void;
  startRound: () => void;
  restartRound: () => void;
  update: (dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

// keep |vx| >= MIN_HORIZONTAL_FRAC of the total speed, preserving total speed,
// so a near-vertical bounce still crosses the arena instead of stalling top<->bottom
const enforceMinHorizontal = (ball: Ball, minFrac = MIN_HORIZONTAL_FRAC): void => {
  const speed = len(ball.vel);
  if (speed < 1) {
    return;
  }
  const minVx = speed * minFrac;
  if (Math.abs(ball.vel.x) < minVx) {
    const sign = ball.vel.x >= 0 ? 1 : -1;
    ball.vel.x = sign * minVx;
    const vy2 = Math.max(0, speed * speed - ball.vel.x * ball.vel.x);
    ball.vel.y = Math.sign(ball.vel.y || 1) * Math.sqrt(vy2);
  }
};

const paddleEndpoints = (
  paddle: Paddle,
  wallX: number,
  smashOffset: number
): { a: Vec; b: Vec } => {
  const outward = paddle.side === "left" ? 1 : -1;
  const cx = wallX + outward * (smashOffset + paddle.slideX);
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
  particles: ParticleSystem,
  speedCap: number | null
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
  const hitRadius = BALL_R + PADDLE_THICK;
  if (d > hitRadius) {
    return false;
  }

  let normal = sub(ball.pos, closest);
  let normalLen = len(normal);
  if (normalLen < 0.001) {
    const n1 = vec(-abNorm.y, abNorm.x);
    const n2 = vec(abNorm.y, -abNorm.x);
    const towardN1 = ball.vel.x * n1.x + ball.vel.y * n1.y;
    normal = towardN1 < 0 ? n1 : n2;
    normalLen = 1;
  } else {
    normal = vec(normal.x / normalLen, normal.y / normalLen);
  }
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
  const target = speed * boost + 40;
  const newSpeed =
    speedCap === null ? Math.max(target, 220) : clamp(target, 220, speedCap);
  ball.vel.x *= newSpeed;
  ball.vel.y *= newSpeed;
  ball.rally += 1;
  const separation = hitRadius + 2;
  ball.pos.x = closest.x + normal.x * separation;
  ball.pos.y = closest.y + normal.y * separation;
  enforceMinHorizontal(ball);

  if (smash > 0) {
    audio.smash();
    particles.emit(closest, 8, 55, 180);
  } else if (spinReady) {
    audio.spin();
    ball.spin = clamp(ball.spin + (Math.random() > 0.5 ? 1 : -1) * 1.2, -3, 3);
    particles.emit(closest, 5, 200, 140);
  } else {
    audio.bounce();
    particles.emit(closest, 4, 180, 100);
  }
  return true;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let currentMode: ModeId = "duel";
  let winScore = 5;
  const settings = { ...DEFAULT_GOAL_SETTINGS };
  let scoreP1 = 0;
  let scoreP2 = 0;
  let bestRally = 0;
  let roundTimer = 0;
  let shake = 0;
  let winner: 1 | 2 | null = null;
  let goals: Goal[] = [];
  const particles = new ParticleSystem();
  const trails: TrailPoint[] = [];

  const p1: Paddle = {
    y: h * 0.5,
    slideX: 0,
    angle: 0,
    smash: 0,
    spinReady: false,
    hue: 190,
    side: "left"
  };
  const p2: Paddle = {
    y: h * 0.5,
    slideX: 0,
    angle: 0,
    smash: 0,
    spinReady: false,
    hue: 320,
    side: "right"
  };

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
    enforceMinHorizontal(ball);
  };

  const resetPaddles = (): void => {
    p1.y = h * 0.5;
    p2.y = h * 0.5;
    p1.slideX = 0;
    p2.slideX = 0;
    p1.angle = 0;
    p2.angle = 0;
    p1.smash = 0;
    p2.smash = 0;
    p1.spinReady = false;
    p2.spinReady = false;
  };

  // how far a paddle may slide inward from its wall (0 when free move is off)
  const maxSlide = (): number =>
    settings.freeMove
      ? MOVE_RANGE_STEPS[settings.moveRangeIdx] * (w * 0.5 - WALL_PAD - 10)
      : 0;

  const randomGoalY = (goalH: number): number => {
    const minY = WALL_PAD + goalH * 0.5;
    const maxY = h - WALL_PAD - goalH * 0.5;
    return minY + Math.random() * (maxY - minY);
  };

  const makeGoals = (): Goal[] => {
    const goalH = GOAL_SIZE_STEPS[settings.sizeIdx] * (h - 2 * WALL_PAD);
    const drift = GOAL_DRIFT_STEPS[settings.driftIdx];
    const period = DISAPPEAR_STEPS[settings.disappearIdx];
    const count = GOAL_COUNT_STEPS[settings.countIdx];
    const minY = WALL_PAD + goalH * 0.5;
    const maxY = h - WALL_PAD - goalH * 0.5;
    const span = maxY - minY;
    const out: Goal[] = [];
    for (const side of ["left", "right"] as const) {
      // left drifts down, right drifts up; stagger disappear phase per goal so
      // they never vanish in lockstep
      const vy = side === "left" ? drift : -drift;
      for (let i = 0; i < count; i += 1) {
        const frac = count === 1 ? 0.5 : i / (count - 1);
        const phase = ((i + (side === "right" ? 0.5 : 0)) / count) % 1;
        out.push({
          side,
          y: minY + frac * span,
          h: goalH,
          vy,
          disappearPeriod: period,
          t: period * phase,
          visible: true
        });
      }
    }
    return out;
  };

  const setupMode = (): void => {
    goals = currentMode === "goals" ? makeGoals() : [];
    if (currentMode === "rally") {
      bestRally = 0;
    }
  };

  const updateGoals = (dt: number): void => {
    for (const g of goals) {
      if (g.vy !== 0) {
        g.y += g.vy * dt;
        const minY = WALL_PAD + g.h * 0.5;
        const maxY = h - WALL_PAD - g.h * 0.5;
        if (g.y < minY) {
          g.y = minY;
          g.vy = Math.abs(g.vy);
        } else if (g.y > maxY) {
          g.y = maxY;
          g.vy = -Math.abs(g.vy);
        }
      }
      if (g.disappearPeriod > 0) {
        g.t += dt;
        if (g.t >= g.disappearPeriod) {
          g.t -= g.disappearPeriod;
          // reappear somewhere new, or stay put and keep riding its drift
          if (settings.disappearJump) {
            g.y = randomGoalY(g.h);
          }
        }
        g.visible = g.t < g.disappearPeriod * DISAPPEAR_VISIBLE_FRAC;
      } else {
        g.visible = true;
      }
    }
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

    // horizontal move (free-move only): convert screen-x input into inward
    // motion, so pressing toward the centre advances the paddle for both sides
    const outward = paddle.side === "left" ? 1 : -1;
    const inward = input.x * outward;
    const moveX = settings.freeMove ? inward : 0;
    paddle.slideX = clamp(paddle.slideX + moveX * PADDLE_SLIDE_SPEED * dt, 0, maxSlide());

    paddle.angle = clamp(
      paddle.angle + tiltAxis * PADDLE_TILT_SPEED * dt,
      -PADDLE_MAX_ANGLE,
      PADDLE_MAX_ANGLE
    );

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
    winner = scoreP1 >= winScore ? 1 : scoreP2 >= winScore ? 2 : null;
    phase = winner !== null ? "matchEnd" : "roundEnd";
    roundTimer = 1.2;
  };

  const onBallExit = (side: "left" | "right", audio: AudioSystem): void => {
    if (currentMode === "rally") {
      bestRally = Math.max(bestRally, ball.rally);
      audio.score();
      shake = 10;
      particles.emit(ball.pos, 30, 55, 200);
      phase = "roundEnd";
      roundTimer = 0.9;
      return;
    }
    const scorer: 1 | 2 = side === "left" ? 2 : 1;
    scoreGoal(scorer, audio);
  };

  const tryScoreGoalZone = (side: "left" | "right", audio: AudioSystem): boolean => {
    const hit = goals.find(
      (g) => g.side === side && g.visible && Math.abs(ball.pos.y - g.y) <= g.h * 0.5 + BALL_R
    );
    if (!hit) {
      return false;
    }
    onBallExit(side, audio);
    return true;
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

    selectMode(mode: ModeId): void {
      if (phase !== "title") {
        return;
      }
      currentMode = mode;
    },

    cycleWinScore(delta: number): void {
      if (phase !== "title") {
        return;
      }
      const options = WIN_SCORE_OPTIONS;
      const i = options.indexOf(winScore as (typeof options)[number]);
      const nextIndex = (i < 0 ? 0 : i + delta + options.length) % options.length;
      winScore = options[nextIndex];
    },

    adjustSetting(kind: SettingKind, delta: number): void {
      if (phase !== "title" || delta === 0) {
        return;
      }
      const clampIdx = (i: number, len: number): number => clamp(i + delta, 0, len - 1);
      if (kind === "count") {
        settings.countIdx = clampIdx(settings.countIdx, GOAL_COUNT_STEPS.length);
      } else if (kind === "size") {
        settings.sizeIdx = clampIdx(settings.sizeIdx, GOAL_SIZE_STEPS.length);
      } else if (kind === "drift") {
        settings.driftIdx = clampIdx(settings.driftIdx, GOAL_DRIFT_STEPS.length);
      } else if (kind === "disappear") {
        settings.disappearIdx = clampIdx(settings.disappearIdx, DISAPPEAR_STEPS.length);
      } else if (kind === "range") {
        settings.moveRangeIdx = clampIdx(settings.moveRangeIdx, MOVE_RANGE_STEPS.length);
      }
    },

    toggleDisappearJump(): void {
      if (phase !== "title") {
        return;
      }
      settings.disappearJump = !settings.disappearJump;
    },

    toggleFreeMove(): void {
      if (phase !== "title") {
        return;
      }
      settings.freeMove = !settings.freeMove;
    },

    toggleUncappedSpeed(): void {
      if (phase !== "title") {
        return;
      }
      settings.uncappedSpeed = !settings.uncappedSpeed;
    },

    startRound(): void {
      phase = "playing";
      scoreP1 = 0;
      scoreP2 = 0;
      winner = null;
      setupMode();
      resetPaddles();
      resetBall(Math.random() > 0.5 ? 1 : 2);
    },

    restartRound(): void {
      phase = "playing";
      scoreP1 = 0;
      scoreP2 = 0;
      winner = null;
      setupMode();
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
          resetBall(
            currentMode === "rally" ? (Math.random() > 0.5 ? 1 : 2) : scoreP1 > scoreP2 ? 2 : 1
          );
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      // free move: horizontal keys drive the slide, rotate moves to Q/E & , / .
      // otherwise the horizontal keys tilt the paddle as before
      const tiltP1 = settings.freeMove ? p1In.rot : p1In.x;
      const tiltP2 = settings.freeMove ? p2In.rot : p2In.x;
      updatePaddle(p1, p1In, p1In.y, tiltP1, dt);
      updatePaddle(p2, p2In, p2In.y, tiltP2, dt);

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
        enforceMinHorizontal(ball);
        audio.bounce();
      }
      if (ball.pos.y + BALL_R > bottom) {
        ball.pos.y = bottom - BALL_R;
        ball.vel.y = -Math.abs(ball.vel.y);
        enforceMinHorizontal(ball);
        audio.bounce();
      }

      const leftWall = WALL_PAD;
      const rightWall = w - WALL_PAD;

      if (currentMode === "goals") {
        updateGoals(dt);
        if (ball.pos.x - BALL_R < leftWall - GOAL_DEPTH) {
          if (tryScoreGoalZone("left", audio)) {
            return;
          }
          ball.pos.x = leftWall - GOAL_DEPTH + BALL_R;
          ball.vel.x = Math.abs(ball.vel.x);
          enforceMinHorizontal(ball);
          audio.bounce();
        }
        if (ball.pos.x + BALL_R > rightWall + GOAL_DEPTH) {
          if (tryScoreGoalZone("right", audio)) {
            return;
          }
          ball.pos.x = rightWall + GOAL_DEPTH - BALL_R;
          ball.vel.x = -Math.abs(ball.vel.x);
          enforceMinHorizontal(ball);
          audio.bounce();
        }
      } else {
        if (ball.pos.x - BALL_R < leftWall - GOAL_DEPTH) {
          onBallExit("left", audio);
          return;
        }
        if (ball.pos.x + BALL_R > rightWall + GOAL_DEPTH) {
          onBallExit("right", audio);
          return;
        }
      }

      const p1Seg = paddleEndpoints(p1, leftWall, p1.smash * 22);
      const p2Seg = paddleEndpoints(p2, rightWall, p2.smash * 22);
      const speedCap = settings.uncappedSpeed ? null : 720;

      const p1Hit = reflectBallOffSegment(
        ball,
        p1Seg.a,
        p1Seg.b,
        p1.smash,
        p1.spinReady,
        audio,
        particles,
        speedCap
      );
      if (p1Hit) {
        p1.spinReady = false;
      }
      const p2Hit = reflectBallOffSegment(
        ball,
        p2Seg.a,
        p2Seg.b,
        p2.smash,
        p2.spinReady,
        audio,
        particles,
        speedCap
      );
      if (p2Hit) {
        p2.spinReady = false;
      }
      if (currentMode === "rally" && (p1Hit || p2Hit) && ball.rally > 0 && ball.rally % 5 === 0) {
        audio.spin();
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

      if (currentMode === "goals") {
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(0, top, leftWall - GOAL_DEPTH, bottom - top);
        ctx.fillRect(rightWall + GOAL_DEPTH, top, rw - rightWall - GOAL_DEPTH, bottom - top);

        for (const g of goals) {
          const hue = g.side === "left" ? 350 : 195;
          const x = g.side === "left" ? 0 : rightWall + GOAL_DEPTH;
          const gw = g.side === "left" ? leftWall - GOAL_DEPTH : rw - rightWall - GOAL_DEPTH;
          const gy = g.y - g.h * 0.5;
          ctx.save();
          ctx.globalCompositeOperation = "lighter";
          ctx.fillStyle = `hsla(${hue}, 100%, 60%, ${g.visible ? 0.45 : 0.08})`;
          ctx.shadowColor = `hsla(${hue}, 100%, 55%, ${g.visible ? 0.8 : 0.15})`;
          ctx.shadowBlur = g.visible ? 22 : 6;
          ctx.fillRect(x, gy, gw, g.h);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = "rgba(255, 60, 100, 0.25)";
        ctx.fillRect(0, top, leftWall - GOAL_DEPTH, bottom - top);
        ctx.fillStyle = "rgba(60, 200, 255, 0.25)";
        ctx.fillRect(rightWall + GOAL_DEPTH, top, rw - rightWall - GOAL_DEPTH, bottom - top);
      }

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 14]);
      ctx.beginPath();
      ctx.moveTo(rw * 0.5, top);
      ctx.lineTo(rw * 0.5, bottom);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

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
      // cap the rally-driven blur — an ever-growing shadowBlur tanks the frame
      // rate during long rallies
      ctx.shadowBlur = 18 + Math.min(ball.rally, 12) * 2;
      ctx.beginPath();
      ctx.arc(ball.pos.x, ball.pos.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      if (currentMode === "rally") {
        return {
          left: "",
          center: phase === "title" ? "" : `Rally ${ball.rally}`,
          right: `Best ${bestRally}`
        };
      }
      return {
        left: `P1 ${scoreP1}`,
        center: phase === "playing" ? MODE_LABEL[currentMode] : phase === "roundEnd" ? "GOAL!" : "",
        right: `P2 ${scoreP2}`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      const help = `${MODE_HELP[currentMode]}\n\n${controlsHelp(settings.freeMove)}`;
      if (phase === "title") {
        const digits: Record<ModeId, string> = { duel: "1", rally: "2", goals: "3" };
        const modeLines = (["duel", "rally", "goals"] as ModeId[])
          .map((m) => {
            const marker = m === currentMode ? "▸" : " ";
            return `${marker} ${digits[m]} ${MODE_LABEL[m]} — ${MODE_DESCRIPTION[m]}`;
          })
          .join("\n");

        const opts: string[] = [];
        if (currentMode === "duel" || currentMode === "goals") {
          opts.push(`Win score: ${winScore}   ([ / ])`);
        }
        if (currentMode === "goals") {
          opts.push(`Goals: ${GOAL_COUNT_LABELS[settings.countIdx]}   (N / n)`);
          opts.push(`Goal size: ${GOAL_SIZE_LABELS[settings.sizeIdx]}   (G / g)`);
          opts.push(`Goal drift: ${GOAL_DRIFT_LABELS[settings.driftIdx]}   (M / m)`);
          opts.push(`Disappear: ${DISAPPEAR_LABELS[settings.disappearIdx]}   (D / d)`);
          if (settings.disappearIdx > 0) {
            opts.push(`Reappear: ${disappearJumpLabel(settings.disappearJump)}   (J)`);
          }
        }
        opts.push(`Free move: ${settings.freeMove ? "On" : "Off"}   (F)`);
        if (settings.freeMove) {
          opts.push(`Move range: ${MOVE_RANGE_LABELS[settings.moveRangeIdx]}   ( , / . )`);
        }
        opts.push(`Speed cap: ${settings.uncappedSpeed ? "Off — unlimited" : "On"}   (U)`);

        return {
          title: "RICOCHET",
          body: `${modeLines}\n\n${opts.join("\n")}\n\nEnter to start  ·  R to restart  ·  Hold H for help`,
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
      if (helpHeld) {
        return {
          title: "HOW TO PLAY",
          body: `${help}\n\nRelease H to resume`,
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
