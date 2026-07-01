import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { add, clamp, dist, len, normalize, scale, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const SHIP_R = 16;
const WIN_ROUNDS = 3;
const HAZARD_R = 10;

type Ship = {
  pos: Vec;
  vel: Vec;
  charge: number;
  parry: number;
  hue: number;
  dashDir: Vec;
};

type Hazard = {
  pos: Vec;
  vel: Vec;
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
  getOverlay: () => { title: string; body: string; visible: boolean };
};

const resolveCircleCollision = (
  a: Ship,
  b: Ship,
  audio: AudioSystem,
  particles: ParticleSystem,
  shakeRef: { value: number }
): void => {
  const delta = sub(b.pos, a.pos);
  const d = len(delta);
  const minDist = SHIP_R * 2;
  if (d >= minDist || d < 0.001) {
    return;
  }

  const n = normalize(delta);
  const overlap = minDist - d;
  a.pos = sub(a.pos, scale(n, overlap * 0.5));
  b.pos = add(b.pos, scale(n, overlap * 0.5));

  const relVel = sub(b.vel, a.vel);
  const velAlongNormal = relVel.x * n.x + relVel.y * n.y;
  if (velAlongNormal > 0) {
    return;
  }

  const parryA = a.parry > 0;
  const parryB = b.parry > 0;
  let restitution = 1.1;
  if (parryA || parryB) {
    restitution = 2.2;
    if (parryA) {
      audio.parry();
    }
    if (parryB) {
      audio.parry();
    }
  } else {
    audio.collision();
  }

  const impulse = (-(1 + restitution) * velAlongNormal) / 2;
  a.vel = sub(a.vel, scale(n, impulse));
  b.vel = add(b.vel, scale(n, impulse));

  const impact = Math.abs(impulse);
  shakeRef.value = Math.max(shakeRef.value, impact * 0.08);
  particles.emit(
    vec((a.pos.x + b.pos.x) * 0.5, (a.pos.y + b.pos.y) * 0.5),
    clamp(Math.floor(impact * 3), 6, 30),
    170,
    140 + impact * 20
  );
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let cx = w * 0.5;
  let cy = h * 0.5;
  let arenaRadius = Math.min(w, h) * 0.42;
  let minArenaRadius = Math.min(w, h) * 0.18;
  let roundTimer = 0;
  let roundCount = 0;
  let winsP1 = 0;
  let winsP2 = 0;
  let lastRoundWinner: 1 | 2 | null = null;
  let matchWinner: 1 | 2 | null = null;
  let shake = 0;
  let hazardTimer = 0;

  const particles = new ParticleSystem();
  const hazards: Hazard[] = [];

  const ship1: Ship = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    parry: 0,
    hue: 175,
    dashDir: vec(1, 0)
  };
  const ship2: Ship = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    parry: 0,
    hue: 15,
    dashDir: vec(-1, 0)
  };

  const resetShips = (): void => {
    ship1.pos = vec(cx - arenaRadius * 0.35, cy);
    ship2.pos = vec(cx + arenaRadius * 0.35, cy);
    ship1.vel = vec(0, 0);
    ship2.vel = vec(0, 0);
    ship1.charge = 0;
    ship2.charge = 0;
    ship1.parry = 0;
    ship2.parry = 0;
    ship1.dashDir = vec(1, 0);
    ship2.dashDir = vec(-1, 0);
  };

  const resetArena = (): void => {
    cx = w * 0.5;
    cy = h * 0.5;
    arenaRadius = Math.min(w, h) * 0.42;
    hazards.length = 0;
    hazardTimer = 3;
  };

  const spawnHazard = (): void => {
    const angle = Math.random() * Math.PI * 2;
    const r = arenaRadius * (0.2 + Math.random() * 0.5);
    hazards.push({
      pos: vec(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r),
      vel: vec((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60)
    });
  };

  const updateShip = (
    ship: Ship,
    input: PlayerInput,
    primaryReleased: boolean,
    dt: number,
    audio: AudioSystem
  ): void => {
    const thrust = normalize(vec(input.x, input.y));
    ship.vel.x += thrust.x * 480 * dt;
    ship.vel.y += thrust.y * 480 * dt;
    ship.vel.x *= Math.pow(0.985, dt * 120);
    ship.vel.y *= Math.pow(0.985, dt * 120);

    if (len(thrust) > 0.1) {
      ship.dashDir = thrust;
    }

    if (input.primary) {
      ship.charge = clamp(ship.charge + 2.5 * dt, 0, 1);
    } else if (primaryReleased && ship.charge > 0.05) {
      const power = 320 + ship.charge * 520;
      ship.vel = add(ship.vel, scale(ship.dashDir, power));
      ship.charge = 0;
      audio.dash();
    } else if (!input.primary) {
      ship.charge = Math.max(0, ship.charge - 4 * dt);
    }

    if (input.secondary && ship.parry <= 0) {
      ship.parry = 0.35;
      audio.parry();
    }
    ship.parry = Math.max(0, ship.parry - dt);
  };

  const constrainToArena = (ship: Ship): boolean => {
    const offset = sub(ship.pos, vec(cx, cy));
    const d = len(offset);
    if (d <= arenaRadius - SHIP_R) {
      return false;
    }
    const n = normalize(offset);
    ship.pos = add(vec(cx, cy), scale(n, arenaRadius - SHIP_R - 1));
    return true;
  };

  const checkKnockout = (audio: AudioSystem): 1 | 2 | null => {
    const d1 = dist(ship1.pos, vec(cx, cy));
    const d2 = dist(ship2.pos, vec(cx, cy));
    const out1 = d1 > arenaRadius;
    const out2 = d2 > arenaRadius;
    if (out1 && !out2) {
      audio.knockout();
      return 2;
    }
    if (out2 && !out1) {
      audio.knockout();
      return 1;
    }
    if (out1 && out2) {
      audio.knockout();
      return d1 > d2 ? 2 : 1;
    }
    return null;
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      cx = w * 0.5;
      cy = h * 0.5;
      arenaRadius = Math.min(w, h) * 0.42;
      minArenaRadius = Math.min(w, h) * 0.18;
      resetShips();
    },

    startRound(): void {
      phase = "playing";
      winsP1 = 0;
      winsP2 = 0;
      matchWinner = null;
      roundCount = 1;
      resetArena();
      resetShips();
    },

    restartRound(): void {
      phase = "playing";
      winsP1 = 0;
      winsP2 = 0;
      matchWinner = null;
      roundCount = 1;
      resetArena();
      resetShips();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 24);

      if (phase === "roundEnd" || phase === "matchEnd") {
        roundTimer -= dt;
        if (roundTimer <= 0 && phase === "roundEnd") {
          phase = "playing";
          roundCount += 1;
          resetArena();
          resetShips();
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      arenaRadius = Math.max(minArenaRadius, arenaRadius - dt * 8);

      updateShip(ship1, p1, input.primaryReleased(1), dt, audio);
      updateShip(ship2, p2, input.primaryReleased(2), dt, audio);

      ship1.pos = add(ship1.pos, scale(ship1.vel, dt));
      ship2.pos = add(ship2.pos, scale(ship2.vel, dt));

      const shakeRef = { value: shake };
      resolveCircleCollision(ship1, ship2, audio, particles, shakeRef);
      shake = shakeRef.value;

      hazardTimer -= dt;
      if (hazardTimer <= 0) {
        spawnHazard();
        hazardTimer = 2.5 + Math.random() * 2;
      }

      for (const hazard of hazards) {
        hazard.pos = add(hazard.pos, scale(hazard.vel, dt));
        const toCenter = sub(vec(cx, cy), hazard.pos);
        const d = len(toCenter);
        if (d > arenaRadius * 0.85) {
          hazard.vel = add(hazard.vel, scale(normalize(toCenter), 40 * dt));
        }

        for (const ship of [ship1, ship2]) {
          if (dist(ship.pos, hazard.pos) < SHIP_R + HAZARD_R) {
            const push = normalize(sub(ship.pos, hazard.pos));
            ship.vel = add(ship.vel, scale(push, 200));
            particles.emit(hazard.pos, 8, 45, 100);
            audio.collision();
          }
        }
      }

      constrainToArena(ship1);
      constrainToArena(ship2);

      const knockout = checkKnockout(audio);
      if (knockout !== null) {
        lastRoundWinner = knockout;
        shake = 16;
        particles.emit(knockout === 1 ? ship2.pos : ship1.pos, 50, knockout === 1 ? 175 : 15, 240);
        if (knockout === 1) {
          winsP1 += 1;
        } else {
          winsP2 += 1;
        }
        matchWinner = winsP1 >= WIN_ROUNDS ? 1 : winsP2 >= WIN_ROUNDS ? 2 : null;
        phase = matchWinner !== null ? "matchEnd" : "roundEnd";
        roundTimer = 1.5;
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      ctx.fillStyle = "#060810";
      ctx.fillRect(0, 0, rw, rh);

      ctx.save();
      ctx.strokeStyle = "rgba(0, 220, 200, 0.06)";
      ctx.lineWidth = 1;
      for (let r = 40; r < Math.max(rw, rh); r += 40) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255, 80, 80, 0.5)";
      ctx.shadowColor = "rgba(255, 60, 60, 0.6)";
      ctx.shadowBlur = 16;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(0, 220, 200, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, arenaRadius - 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      for (const hazard of hazards) {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = "rgba(255, 180, 60, 0.7)";
        ctx.shadowColor = "rgba(255, 120, 0, 0.8)";
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(hazard.pos.x, hazard.pos.y, HAZARD_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const drawShip = (ship: Ship, label: string): void => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = `hsl(${ship.hue}, 100%, 55%)`;
        ctx.shadowColor = `hsl(${ship.hue}, 100%, 45%)`;
        ctx.shadowBlur = 16 + ship.charge * 20;
        ctx.beginPath();
        ctx.arc(ship.pos.x, ship.pos.y, SHIP_R, 0, Math.PI * 2);
        ctx.fill();

        if (ship.parry > 0) {
          ctx.strokeStyle = `hsla(${ship.hue}, 100%, 80%, ${ship.parry / 0.35})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(ship.pos.x, ship.pos.y, SHIP_R + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (ship.charge > 0.05) {
          const dir = ship.dashDir;
          ctx.strokeStyle = `hsla(${ship.hue}, 100%, 70%, ${ship.charge})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(ship.pos.x, ship.pos.y);
          ctx.lineTo(
            ship.pos.x + dir.x * (20 + ship.charge * 40),
            ship.pos.y + dir.y * (20 + ship.charge * 40)
          );
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(label, ship.pos.x, ship.pos.y - SHIP_R - 10);
        ctx.restore();
      };

      drawShip(ship1, "P1");
      drawShip(ship2, "P2");

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      return {
        left: `P1 ${winsP1}`,
        center:
          phase === "playing"
            ? `Round ${roundCount} · Arena ${Math.round(arenaRadius)}`
            : phase === "roundEnd" && lastRoundWinner !== null
              ? `P${lastRoundWinner} wins round!`
              : "",
        right: `P2 ${winsP2}`
      };
    },

    getOverlay(): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        return {
          title: "VORTEX",
          body:
            "Sumo knockout in a shrinking arena.\n" +
            "WASD · Arrows = thrust. Hold Shift · RShift = charge dash, release to lunge.\n" +
            "Space · Enter = parry shield.\n\n" +
            "Best of 3 rounds. Press Enter to start.",
          visible: true
        };
      }
      if (phase === "matchEnd" && matchWinner !== null) {
        return {
          title: `PLAYER ${matchWinner} WINS`,
          body: `Match score ${winsP1} — ${winsP2}\nPress R to restart.`,
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
