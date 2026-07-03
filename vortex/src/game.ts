import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { add, clamp, dist, len, lerp, normalize, scale, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const SHIP_R = 16;
const WIN_ROUNDS = 3;
const HAZARD_R = 10;

type Ship = {
  pos: Vec;
  vel: Vec;
  charge: number;
  parry: number;
  parryCd: number;
  hue: number;
  dashDir: Vec;
  trail: Vec[];
};

type Hazard = {
  pos: Vec;
  vel: Vec;
  life: number;
  cooldown: number;
};

const HAZARD_MAX = 4;
const HAZARD_LIFE = 12;
const PARRY_TIME = 0.32;
const PARRY_CD = 0.75;

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
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const HELP_BODY =
  "Sumo knockout — dash-slam your rival out of the\n" +
  "shrinking arena. Best of 3 rounds.\n\n" +
  "P1  ·  W A S D thrust  ·  hold Left Shift charge dash  ·  Space parry\n" +
  "P2  ·  Arrows thrust  ·  hold Right Shift charge dash  ·  Enter parry";

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

  // Quality fades from 1 (just activated) to 0 (window about to expire), so
  // landing the hit right as you press parry deflects hardest.
  const qA = clamp(a.parry / PARRY_TIME, 0, 1);
  const qB = clamp(b.parry / PARRY_TIME, 0, 1);
  const parrying = qA > 0 || qB > 0;
  const restitution = parrying ? lerp(1.1, 2.2, Math.max(qA, qB)) : 1.1;
  if (parrying) {
    audio.parry();
  } else {
    audio.collision();
  }

  // A perfect solo parry (advantage = 1) pins the defender's share to 0 and
  // doubles the attacker's, so the defender stands still and the attacker is
  // fully deflected. Equal/no parries fall back to the original 1/1 split.
  const advantage = clamp(qA - qB, -1, 1);
  const shareA = 1 - advantage;
  const shareB = 1 + advantage;

  const impulse = (-(1 + restitution) * velAlongNormal) / 2;
  a.vel = sub(a.vel, scale(n, impulse * shareA));
  b.vel = add(b.vel, scale(n, impulse * shareB));

  const impact = Math.abs(impulse) * Math.max(shareA, shareB);
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
    parryCd: 0,
    hue: 175,
    dashDir: vec(1, 0),
    trail: []
  };
  const ship2: Ship = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    parry: 0,
    parryCd: 0,
    hue: 15,
    dashDir: vec(-1, 0),
    trail: []
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
    ship1.parryCd = 0;
    ship2.parryCd = 0;
    ship1.dashDir = vec(1, 0);
    ship2.dashDir = vec(-1, 0);
    ship1.trail = [];
    ship2.trail = [];
  };

  const resetArena = (): void => {
    cx = w * 0.5;
    cy = h * 0.5;
    arenaRadius = Math.min(w, h) * 0.42;
    hazards.length = 0;
    hazardTimer = 4;
    particles.clear();
  };

  const spawnHazard = (): void => {
    if (hazards.length >= HAZARD_MAX) {
      return;
    }
    const angle = Math.random() * Math.PI * 2;
    const r = arenaRadius * (0.2 + Math.random() * 0.45);
    hazards.push({
      pos: vec(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r),
      vel: vec((Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60),
      life: HAZARD_LIFE,
      cooldown: 0
    });
  };

  const updateShip = (
    ship: Ship,
    input: PlayerInput,
    primaryReleased: boolean,
    secondaryPressed: boolean,
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

    if (secondaryPressed && ship.parryCd <= 0) {
      ship.parry = PARRY_TIME;
      ship.parryCd = PARRY_CD;
      audio.parry();
    }
    ship.parry = Math.max(0, ship.parry - dt);
    ship.parryCd = Math.max(0, ship.parryCd - dt);
  };

  // 0 when safe near the middle, ramps to 1 as the ship approaches the rim.
  const rimDanger = (ship: Ship): number => {
    const d = dist(ship.pos, vec(cx, cy));
    return clamp((d / arenaRadius - 0.6) / 0.4, 0, 1);
  };

  const checkKnockout = (audio: AudioSystem): 1 | 2 | null => {
    const d1 = dist(ship1.pos, vec(cx, cy));
    const d2 = dist(ship2.pos, vec(cx, cy));
    // No wall: the platform edge is the death line. You're out once your center
    // clears the rim (roughly half your body over the edge).
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

      updateShip(ship1, p1, input.primaryReleased(1), input.secondaryPressed(1), dt, audio);
      updateShip(ship2, p2, input.primaryReleased(2), input.secondaryPressed(2), dt, audio);

      ship1.pos = add(ship1.pos, scale(ship1.vel, dt));
      ship2.pos = add(ship2.pos, scale(ship2.vel, dt));

      for (const ship of [ship1, ship2]) {
        ship.trail.push(vec(ship.pos.x, ship.pos.y));
        if (ship.trail.length > 14) {
          ship.trail.shift();
        }
      }

      const shakeRef = { value: shake };
      resolveCircleCollision(ship1, ship2, audio, particles, shakeRef);
      shake = shakeRef.value;

      hazardTimer -= dt;
      if (hazardTimer <= 0) {
        spawnHazard();
        hazardTimer = 3 + Math.random() * 2.5;
      }

      for (let i = hazards.length - 1; i >= 0; i -= 1) {
        const hazard = hazards[i];
        hazard.life -= dt;
        hazard.cooldown = Math.max(0, hazard.cooldown - dt);
        if (hazard.life <= 0) {
          particles.emit(hazard.pos, 6, 45, 80);
          hazards.splice(i, 1);
          continue;
        }

        hazard.pos = add(hazard.pos, scale(hazard.vel, dt));
        const toCenter = sub(vec(cx, cy), hazard.pos);
        const d = len(toCenter);
        // Keep hazards on the platform; the shrinking edge can otherwise strand them.
        if (d > arenaRadius - HAZARD_R) {
          const inward = normalize(toCenter);
          hazard.pos = add(vec(cx, cy), scale(inward, -(arenaRadius - HAZARD_R)));
          const vn = hazard.vel.x * inward.x + hazard.vel.y * inward.y;
          hazard.vel = sub(hazard.vel, scale(inward, 2 * vn));
        }

        for (const ship of [ship1, ship2]) {
          const between = sub(ship.pos, hazard.pos);
          const gap = len(between);
          if (gap < SHIP_R + HAZARD_R && hazard.cooldown <= 0) {
            const push = normalize(between);
            // Separate so they can't stay overlapped (which spammed particles/audio).
            ship.pos = add(hazard.pos, scale(push, SHIP_R + HAZARD_R + 1));
            ship.vel = add(ship.vel, scale(push, 260));
            hazard.vel = sub(hazard.vel, scale(push, 120));
            hazard.cooldown = 0.25;
            shake = Math.max(shake, 5);
            particles.emit(hazard.pos, 10, 45, 140);
            audio.collision();
          }
        }
      }

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
      // Dark void: anything outside the platform is "off the edge".
      ctx.fillStyle = "#04060c";
      ctx.fillRect(0, 0, rw, rh);

      // The platform surface — a lit disc so falling off the rim reads clearly.
      const surface = ctx.createRadialGradient(cx, cy, arenaRadius * 0.1, cx, cy, arenaRadius);
      surface.addColorStop(0, "rgba(20, 34, 52, 0.95)");
      surface.addColorStop(0.82, "rgba(12, 22, 38, 0.95)");
      surface.addColorStop(1, "rgba(8, 14, 26, 0.95)");
      ctx.fillStyle = surface;
      ctx.beginPath();
      ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
      ctx.fill();

      // Grid rings, clipped to the platform so they reinforce the disc shape.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = "rgba(0, 220, 200, 0.08)";
      ctx.lineWidth = 1;
      for (let r = 40; r < arenaRadius; r += 40) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Warn when either ship is teetering near the rim.
      const danger = Math.max(rimDanger(ship1), rimDanger(ship2));

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const rimAlpha = 0.5 + danger * 0.45;
      ctx.strokeStyle = `rgba(255, ${Math.round(80 - danger * 50)}, ${Math.round(80 - danger * 50)}, ${rimAlpha})`;
      ctx.shadowColor = "rgba(255, 60, 60, 0.6)";
      ctx.shadowBlur = 16 + danger * 24;
      ctx.lineWidth = 3 + danger * 3;
      ctx.beginPath();
      ctx.arc(cx, cy, arenaRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.strokeStyle = "rgba(0, 220, 200, 0.15)";
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
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
        const n = ship.trail.length;
        for (let i = 0; i < n; i += 1) {
          const t = (i + 1) / n;
          const p = ship.trail[i];
          ctx.fillStyle = `hsla(${ship.hue}, 100%, 60%, ${t * 0.35})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, SHIP_R * t * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = `hsl(${ship.hue}, 100%, 55%)`;
        ctx.shadowColor = `hsl(${ship.hue}, 100%, 45%)`;
        ctx.shadowBlur = 16 + ship.charge * 20;
        ctx.beginPath();
        ctx.arc(ship.pos.x, ship.pos.y, SHIP_R, 0, Math.PI * 2);
        ctx.fill();

        // Flash a white warning ring as this ship nears the rim.
        const danger = rimDanger(ship);
        if (danger > 0.01) {
          ctx.strokeStyle = `rgba(255, 255, 255, ${danger * 0.85})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(ship.pos.x, ship.pos.y, SHIP_R + 4 + danger * 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (ship.parry > 0) {
          ctx.strokeStyle = `hsla(${ship.hue}, 100%, 80%, ${ship.parry / PARRY_TIME})`;
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

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        return {
          title: "VORTEX",
          body: HELP_BODY + "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
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
      if (helpHeld) {
        return {
          title: "HOW TO PLAY",
          body: HELP_BODY + "\n\nRelease H to resume",
          visible: true
        };
      }
      return { title: "", body: "", visible: false };
    }
  };
};
