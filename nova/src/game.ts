import type { InputManager, PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { add, clamp, dist, len, normalize, scale, sub, vec, type Vec } from "./vec";

export type GamePhase = "title" | "playing" | "roundEnd" | "matchEnd";

const SHIP_R = 13;
const WIN_ROUNDS = 3; // best of 5

const THRUST_ACC = 440;
const DRAG = 0.9992; // very light — orbits should persist; gravity does the pulling
const MAX_SPEED = 1500;

const FLARE_CHARGE_RATE = 2.5;
const FLARE_MIN = 320;
const FLARE_SPAN = 560;

const SHIELD_TIME = 0.32;
const SHIELD_CD = 0.85;

// A ram only kills when the aggressor has clearly slingshotted up to speed.
const KILL_SPEED = 360;
const KILL_RATIO = 1.3;

const GRAVITY_STEP = 0.15;
const GRAVITY_MIN = 0.4;
const GRAVITY_MAX = 2.5;

type Comet = {
  pos: Vec;
  vel: Vec;
  charge: number;
  shield: number;
  shieldCd: number;
  hue: number;
  dashDir: Vec;
  trail: Vec[];
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
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
};

const HELP_BODY =
  "Orbital slingshot duel — the star's gravity pulls you in.\n" +
  "Dive close to whip up speed, then ram your rival:\n" +
  "the faster comet shatters the slower one. Best of 5.\n\n" +
  "Burn up in the corona or drift into the void and you're out.\n\n" +
  "P1  ·  W A S D thrust  ·  hold Left Shift charge Flare  ·  Space Shield\n" +
  "P2  ·  Arrows thrust  ·  hold Right Shift charge Flare  ·  Enter Shield\n" +
  "[ / ]  ·  tune gravity";

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let cx = w * 0.5;
  let cy = h * 0.5;

  // The three radii that define the ring of play, derived from screen size.
  let baseR = Math.min(w, h) * 0.5;
  let coronaR = baseR * 0.14; // inside this = burn up
  let voidR = baseR * 0.94; // outside this = lost to the void
  let orbitR = baseR * 0.52; // spawn orbit
  let orbitSpeed = 250;
  let gm = orbitSpeed * orbitSpeed * orbitR; // GM so orbitR is a circular orbit at orbitSpeed

  let gravityScale = 1;
  let starPulse = 0;
  let roundTimer = 0;
  let roundCount = 0;
  let winsP1 = 0;
  let winsP2 = 0;
  let lastRoundWinner: 1 | 2 | null = null;
  let lastCause = "";
  let matchWinner: 1 | 2 | null = null;
  let shake = 0;

  const particles = new ParticleSystem();

  const comet1: Comet = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    shield: 0,
    shieldCd: 0,
    hue: 190,
    dashDir: vec(0, -1),
    trail: []
  };
  const comet2: Comet = {
    pos: vec(0, 0),
    vel: vec(0, 0),
    charge: 0,
    shield: 0,
    shieldCd: 0,
    hue: 25,
    dashDir: vec(0, 1),
    trail: []
  };

  const computeGeometry = (): void => {
    cx = w * 0.5;
    cy = h * 0.5;
    baseR = Math.min(w, h) * 0.5;
    coronaR = baseR * 0.14;
    voidR = baseR * 0.94;
    orbitR = baseR * 0.52;
    gm = orbitSpeed * orbitSpeed * orbitR;
  };

  const resetComets = (): void => {
    // Opposite sides of the star, both moving counter-clockwise so they share a
    // period and stay across from each other until a player breaks the symmetry.
    comet1.pos = vec(cx - orbitR, cy);
    comet1.vel = vec(0, -orbitSpeed);
    comet1.dashDir = vec(0, -1);
    comet2.pos = vec(cx + orbitR, cy);
    comet2.vel = vec(0, orbitSpeed);
    comet2.dashDir = vec(0, 1);
    for (const c of [comet1, comet2]) {
      c.charge = 0;
      c.shield = 0;
      c.shieldCd = 0;
      c.trail = [];
    }
  };

  const resetArena = (): void => {
    particles.clear();
    starPulse = 0;
  };

  const updateComet = (
    c: Comet,
    input: PlayerInput,
    primaryReleased: boolean,
    dt: number,
    audio: AudioSystem
  ): void => {
    // Gravity toward the star — softened near the core so it doesn't blow up.
    const toStar = sub(vec(cx, cy), c.pos);
    const r = Math.max(len(toStar), coronaR * 0.8);
    const g = (gm * gravityScale) / (r * r);
    const gDir = normalize(toStar);
    c.vel = add(c.vel, scale(gDir, g * dt));

    // Player thrust.
    const thrust = normalize(vec(input.x, input.y));
    c.vel.x += thrust.x * THRUST_ACC * dt;
    c.vel.y += thrust.y * THRUST_ACC * dt;
    if (len(thrust) > 0.1) {
      c.dashDir = thrust;
    }

    // Flare: charge while primary held, release to lunge along the aim.
    if (input.primary) {
      c.charge = clamp(c.charge + FLARE_CHARGE_RATE * dt, 0, 1);
    } else if (primaryReleased && c.charge > 0.05) {
      const power = FLARE_MIN + c.charge * FLARE_SPAN;
      c.vel = add(c.vel, scale(c.dashDir, power));
      c.charge = 0;
      audio.flare();
      particles.emit(c.pos, 10, c.hue, 160);
    } else if (!input.primary) {
      c.charge = Math.max(0, c.charge - 4 * dt);
    }

    // Shield: timed parry with a cooldown.
    if (input.secondary && c.shield <= 0 && c.shieldCd <= 0) {
      c.shield = SHIELD_TIME;
      c.shieldCd = SHIELD_CD;
      audio.shield();
    }
    c.shield = Math.max(0, c.shield - dt);
    c.shieldCd = Math.max(0, c.shieldCd - dt);

    // Light drag + speed cap keep the sim stable without killing orbits.
    c.vel.x *= Math.pow(DRAG, dt * 120);
    c.vel.y *= Math.pow(DRAG, dt * 120);
    const speed = len(c.vel);
    if (speed > MAX_SPEED) {
      c.vel = scale(c.vel, MAX_SPEED / speed);
    }
  };

  // Elastic bounce; returns the loser (1|2) if the exchange was lethal, else null.
  const resolveCollision = (audio: AudioSystem): 1 | 2 | null => {
    const delta = sub(comet2.pos, comet1.pos);
    const d = len(delta);
    const minDist = SHIP_R * 2;
    if (d >= minDist || d < 0.001) {
      return null;
    }

    const n = normalize(delta);
    const overlap = minDist - d;
    comet1.pos = sub(comet1.pos, scale(n, overlap * 0.5));
    comet2.pos = add(comet2.pos, scale(n, overlap * 0.5));

    const s1 = len(comet1.vel);
    const s2 = len(comet2.vel);

    const relVel = sub(comet2.vel, comet1.vel);
    const velAlongNormal = relVel.x * n.x + relVel.y * n.y;
    if (velAlongNormal < 0) {
      const restitution = comet1.shield > 0 || comet2.shield > 0 ? 1.9 : 1.05;
      const impulse = (-(1 + restitution) * velAlongNormal) / 2;
      comet1.vel = sub(comet1.vel, scale(n, impulse));
      comet2.vel = add(comet2.vel, scale(n, impulse));
      shake = Math.max(shake, Math.min(Math.abs(impulse) * 0.06, 18));
    }

    const mid = vec((comet1.pos.x + comet2.pos.x) * 0.5, (comet1.pos.y + comet2.pos.y) * 0.5);

    // A shield reflects the ram — the shielded comet always wins the exchange.
    if (comet1.shield > 0 && comet2.shield <= 0) {
      particles.emit(mid, 24, comet2.hue, 220);
      return 2;
    }
    if (comet2.shield > 0 && comet1.shield <= 0) {
      particles.emit(mid, 24, comet1.hue, 220);
      return 1;
    }
    if (comet1.shield > 0 && comet2.shield > 0) {
      audio.ram();
      particles.emit(mid, 12, 200, 160);
      return null;
    }

    // No shields: the clearly faster comet shatters the slower one.
    const fast = Math.max(s1, s2);
    const slow = Math.min(s1, s2);
    if (fast >= KILL_SPEED && fast >= slow * KILL_RATIO) {
      const loser: 1 | 2 = s1 < s2 ? 1 : 2;
      particles.emit(mid, 24, loser === 1 ? comet1.hue : comet2.hue, 220);
      return loser;
    }

    audio.ram();
    particles.emit(mid, 10, 200, 150);
    return null;
  };

  // dist to the star as a share of the corona (0 = at corona edge, 1 = safe).
  const coronaDanger = (c: Comet): number => {
    const d = dist(c.pos, vec(cx, cy));
    return clamp(1 - (d - coronaR) / (baseR * 0.22), 0, 1);
  };

  const voidDanger = (c: Comet): number => {
    const d = dist(c.pos, vec(cx, cy));
    return clamp((d - voidR * 0.72) / (voidR * 0.28), 0, 1);
  };

  const awardRound = (winner: 1 | 2, cause: string, deadPos: Vec, deadHue: number, audio: AudioSystem): void => {
    lastRoundWinner = winner;
    lastCause = cause;
    shake = 16;
    particles.emit(deadPos, 54, deadHue, 260);
    if (winner === 1) {
      winsP1 += 1;
    } else {
      winsP2 += 1;
    }
    matchWinner = winsP1 >= WIN_ROUNDS ? 1 : winsP2 >= WIN_ROUNDS ? 2 : null;
    phase = matchWinner !== null ? "matchEnd" : "roundEnd";
    roundTimer = 1.6;
    audio.shatter();
  };

  return {
    get phase() {
      return phase;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      computeGeometry();
      resetComets();
    },

    startRound(): void {
      phase = "playing";
      winsP1 = 0;
      winsP2 = 0;
      matchWinner = null;
      roundCount = 1;
      resetArena();
      resetComets();
    },

    restartRound(): void {
      phase = "playing";
      winsP1 = 0;
      winsP2 = 0;
      matchWinner = null;
      roundCount = 1;
      resetArena();
      resetComets();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, input: InputManager, audio: AudioSystem): void {
      particles.update(dt);
      shake = Math.max(0, shake - dt * 24);
      starPulse += dt;

      // Live gravity tuning, available on any screen.
      if (input.consumePress("BracketLeft")) {
        gravityScale = clamp(gravityScale - GRAVITY_STEP, GRAVITY_MIN, GRAVITY_MAX);
      }
      if (input.consumePress("BracketRight")) {
        gravityScale = clamp(gravityScale + GRAVITY_STEP, GRAVITY_MIN, GRAVITY_MAX);
      }

      if (phase === "roundEnd" || phase === "matchEnd") {
        roundTimer -= dt;
        if (roundTimer <= 0 && phase === "roundEnd") {
          phase = "playing";
          roundCount += 1;
          resetArena();
          resetComets();
        }
        return;
      }

      if (phase !== "playing") {
        return;
      }

      updateComet(comet1, p1, input.primaryReleased(1), dt, audio);
      updateComet(comet2, p2, input.primaryReleased(2), dt, audio);

      comet1.pos = add(comet1.pos, scale(comet1.vel, dt));
      comet2.pos = add(comet2.pos, scale(comet2.vel, dt));

      for (const c of [comet1, comet2]) {
        c.trail.push(vec(c.pos.x, c.pos.y));
        if (c.trail.length > 22) {
          c.trail.shift();
        }
      }

      const collisionLoser = resolveCollision(audio);
      if (collisionLoser !== null) {
        const winner: 1 | 2 = collisionLoser === 1 ? 2 : 1;
        const dead = collisionLoser === 1 ? comet1 : comet2;
        awardRound(winner, "Shattered on impact", dead.pos, dead.hue, audio);
        return;
      }

      // Boundary deaths: corona (too close) and the void (too far).
      const d1 = dist(comet1.pos, vec(cx, cy));
      const d2 = dist(comet2.pos, vec(cx, cy));
      const burn1 = d1 < coronaR;
      const burn2 = d2 < coronaR;
      const void1 = d1 > voidR;
      const void2 = d2 > voidR;
      const out1 = burn1 || void1;
      const out2 = burn2 || void2;

      if (out1 || out2) {
        let loser: 1 | 2;
        if (out1 && out2) {
          // Both gone at once — the one further past its line loses.
          const ex1 = burn1 ? coronaR - d1 : d1 - voidR;
          const ex2 = burn2 ? coronaR - d2 : d2 - voidR;
          loser = ex1 >= ex2 ? 1 : 2;
        } else {
          loser = out1 ? 1 : 2;
        }
        const winner: 1 | 2 = loser === 1 ? 2 : 1;
        const burned = loser === 1 ? burn1 : burn2;
        const dead = loser === 1 ? comet1 : comet2;
        if (burned) {
          audio.burn();
        }
        awardRound(winner, burned ? "Burned in the star" : "Lost to the void", dead.pos, dead.hue, audio);
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      // Deep space.
      ctx.fillStyle = "#04030a";
      ctx.fillRect(0, 0, rw, rh);

      // Faint gravity-field rings out to the void edge.
      ctx.save();
      ctx.strokeStyle = "rgba(255, 170, 90, 0.05)";
      ctx.lineWidth = 1;
      for (let r = coronaR + 40; r < voidR; r += 46) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // The void edge — drift past it and you're gone.
      ctx.save();
      const nearVoid = Math.max(voidDanger(comet1), voidDanger(comet2));
      ctx.strokeStyle = `rgba(120, 150, 255, ${0.18 + nearVoid * 0.4})`;
      ctx.setLineDash([6, 10]);
      ctx.lineWidth = 1.5 + nearVoid * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, voidR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // The star: layered radial glow with a slow pulse.
      const pulse = 1 + Math.sin(starPulse * 2.2) * 0.06;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, coronaR * 2.6 * pulse);
      glow.addColorStop(0, "rgba(255, 240, 210, 0.95)");
      glow.addColorStop(0.28, "rgba(255, 180, 90, 0.75)");
      glow.addColorStop(0.6, "rgba(255, 110, 40, 0.28)");
      glow.addColorStop(1, "rgba(255, 80, 20, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR * 2.6 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // The lethal corona ring.
      ctx.strokeStyle = "rgba(255, 150, 60, 0.7)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR, 0, Math.PI * 2);
      ctx.stroke();

      // Bright core.
      ctx.fillStyle = "rgba(255, 250, 235, 0.95)";
      ctx.beginPath();
      ctx.arc(cx, cy, coronaR * 0.55 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const drawComet = (c: Comet, label: string): void => {
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const n = c.trail.length;
        for (let i = 0; i < n; i += 1) {
          const t = (i + 1) / n;
          const p = c.trail[i];
          ctx.fillStyle = `hsla(${c.hue}, 100%, 62%, ${t * 0.3})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y, SHIP_R * t * 0.85, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = `hsl(${c.hue}, 100%, 58%)`;
        ctx.shadowColor = `hsl(${c.hue}, 100%, 50%)`;
        ctx.shadowBlur = 16 + c.charge * 22;
        ctx.beginPath();
        ctx.arc(c.pos.x, c.pos.y, SHIP_R, 0, Math.PI * 2);
        ctx.fill();

        // Corona-proximity warning ring.
        const burnDanger = coronaDanger(c);
        if (burnDanger > 0.01) {
          ctx.strokeStyle = `rgba(255, 200, 120, ${burnDanger * 0.9})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(c.pos.x, c.pos.y, SHIP_R + 4 + burnDanger * 6, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (c.shield > 0) {
          ctx.strokeStyle = `hsla(${c.hue}, 100%, 85%, ${c.shield / SHIELD_TIME})`;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(c.pos.x, c.pos.y, SHIP_R + 8, 0, Math.PI * 2);
          ctx.stroke();
        }

        if (c.charge > 0.05) {
          const dir = c.dashDir;
          ctx.strokeStyle = `hsla(${c.hue}, 100%, 72%, ${c.charge})`;
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(c.pos.x, c.pos.y);
          ctx.lineTo(
            c.pos.x + dir.x * (20 + c.charge * 44),
            c.pos.y + dir.y * (20 + c.charge * 44)
          );
          ctx.stroke();
        }

        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(label, c.pos.x, c.pos.y - SHIP_R - 10);
        ctx.restore();
      };

      drawComet(comet1, "P1");
      drawComet(comet2, "P2");

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      const speed1 = Math.round(len(comet1.vel));
      const speed2 = Math.round(len(comet2.vel));
      return {
        left: `P1 ${winsP1}  ·  ${speed1}`,
        center:
          phase === "playing"
            ? `Round ${roundCount}  ·  Gravity ${gravityScale.toFixed(1)}×`
            : phase === "roundEnd" && lastRoundWinner !== null
              ? `P${lastRoundWinner} wins — ${lastCause}`
              : "",
        right: `${speed2}  ·  ${winsP2} P2`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        return {
          title: "NOVA",
          body: HELP_BODY + "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "matchEnd" && matchWinner !== null) {
        return {
          title: `PLAYER ${matchWinner} WINS`,
          body: `Match score ${winsP1} — ${winsP2}\n${lastCause}\nPress R to restart.`,
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
