import type { PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, vec } from "./vec";

export type GamePhase = "title" | "playing" | "waveClear" | "gameOver";

type Ring = {
  radius: number;
  scored: boolean;
  hue: number;
};

type HitFlash = {
  angle: number;
  life: number;
  hue: number;
};

const MAX_WAVES = 5;
const PERFECT_WINDOW_PX = 14;
const GOOD_WINDOW_PX = 32;

const HELP_BODY =
  "Rhythm co-op — resonate with the pulsar beat.\n" +
  "Time your hit as a ring reaches your node's track.\n" +
  "Chain perfect hits together to ascend the waves.\n\n" +
  "P1  ·  A/D nudge node  ·  Left Shift hit  ·  Space slow-mo\n" +
  "P2  ·  ←/→ nudge node  ·  Right Shift hit  ·  Enter slow-mo";

export type Game = {
  phase: GamePhase;
  resize: (w: number, h: number) => void;
  startRound: () => void;
  restartRound: () => void;
  onBeat: () => void;
  update: (dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem) => void;
  render: (ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number) => void;
  applyShake: (ctx: CanvasRenderingContext2D) => void;
  getHud: () => { left: string; center: string; right: string };
  getOverlay: (helpHeld: boolean) => { title: string; body: string; visible: boolean };
  getBpm: () => number;
};

export const createGame = (width: number, height: number): Game => {
  let w = width;
  let h = height;
  let phase: GamePhase = "title";
  let cx = w * 0.5;
  let cy = h * 0.5;
  let orbitRadius = Math.min(w, h) * 0.32;

  let wave = 1;
  let bpm = 90;
  let ringSpeed = 0;
  let combo = 0;
  let bloom = 0;
  let scoreP1 = 0;
  let scoreP2 = 0;
  let nodeAngleP1 = -Math.PI * 0.5;
  let nodeAngleP2 = Math.PI * 0.5;
  let focusTimer = 0;
  let focusCooldown = 0;
  let timeScale = 1;
  let waveTimer = 0;
  let shake = 0;
  let pulse = 0;

  const rings: Ring[] = [];
  const particles = new ParticleSystem();
  const hitFlashes: HitFlash[] = [];

  const recomputeRingSpeed = (): void => {
    const beatDuration = 60 / bpm;
    ringSpeed = orbitRadius / beatDuration;
  };

  const spawnRing = (): void => {
    rings.push({ radius: 8, scored: false, hue: 270 + wave * 15 });
  };

  const resetSession = (): void => {
    wave = 1;
    bpm = 90;
    combo = 0;
    bloom = 0;
    scoreP1 = 0;
    scoreP2 = 0;
    nodeAngleP1 = -Math.PI * 0.5;
    nodeAngleP2 = Math.PI * 0.5;
    focusTimer = 0;
    focusCooldown = 0;
    timeScale = 1;
    rings.length = 0;
    hitFlashes.length = 0;
    recomputeRingSpeed();
    spawnRing();
  };

  const nodePos = (angle: number) =>
    vec(cx + Math.cos(angle) * orbitRadius, cy + Math.sin(angle) * orbitRadius);

  const judgeHit = (
    player: 1 | 2,
    quality: "perfect" | "good" | "miss",
    angle: number,
    hue: number,
    audio: AudioSystem
  ): void => {
    if (quality === "miss") {
      combo = 0;
      bloom = Math.max(0, bloom - 12);
      audio.miss();
      shake = 4;
      return;
    }

    if (player === 1) {
      scoreP1 += quality === "perfect" ? 2 : 1;
    } else {
      scoreP2 += quality === "perfect" ? 2 : 1;
    }
    combo += 1;
    bloom = clamp(bloom + (quality === "perfect" ? 14 : 7), 0, 100);
    audio.resonance(quality);
    hitFlashes.push({ angle, life: 0.5, hue });
    particles.emit(nodePos(angle), quality === "perfect" ? 24 : 12, hue, 160);
    shake = quality === "perfect" ? 6 : 3;

    if (bloom >= 100) {
      bloom = 0;
      combo += 2;
      audio.ascend();
      if (wave < MAX_WAVES) {
        wave += 1;
        bpm = 90 + (wave - 1) * 18;
        recomputeRingSpeed();
        phase = "waveClear";
        waveTimer = 1.5;
      } else {
        phase = "gameOver";
      }
    }
  };

  const evaluateRing = (ring: Ring, p1Primary: boolean, p2Primary: boolean, audio: AudioSystem): void => {
    if (ring.scored) {
      return;
    }

    const delta = Math.abs(ring.radius - orbitRadius);
    if (delta > GOOD_WINDOW_PX) {
      return;
    }

    ring.scored = true;
    const inPerfect = delta <= PERFECT_WINDOW_PX;

    if (p1Primary) {
      judgeHit(1, inPerfect ? "perfect" : "good", nodeAngleP1, 200, audio);
    } else {
      judgeHit(1, "miss", nodeAngleP1, 200, audio);
    }

    if (p2Primary) {
      judgeHit(2, inPerfect ? "perfect" : "good", nodeAngleP2, 310, audio);
    } else {
      judgeHit(2, "miss", nodeAngleP2, 310, audio);
    }
  };

  return {
    get phase() {
      return phase;
    },

    getBpm(): number {
      return bpm;
    },

    onBeat(): void {
      if (phase !== "playing") {
        return;
      }
      spawnRing();
      pulse = 1;
    },

    resize(nw: number, nh: number): void {
      w = nw;
      h = nh;
      cx = w * 0.5;
      cy = h * 0.5;
      orbitRadius = Math.min(w, h) * 0.32;
      recomputeRingSpeed();
    },

    startRound(): void {
      phase = "playing";
      resetSession();
    },

    restartRound(): void {
      phase = "playing";
      resetSession();
    },

    update(dt: number, p1: PlayerInput, p2: PlayerInput, audio: AudioSystem): void {
      if (focusTimer > 0) {
        timeScale = 0.35;
        focusTimer -= dt;
      } else {
        timeScale = 1;
      }
      if (focusCooldown > 0) {
        focusCooldown -= dt;
      }

      const scaledDt = dt * timeScale;
      particles.update(scaledDt);
      pulse = Math.max(0, pulse - scaledDt * 3);
      shake = Math.max(0, shake - scaledDt * 20);

      if (phase === "waveClear") {
        waveTimer -= dt;
        if (waveTimer <= 0) {
          phase = "playing";
          rings.length = 0;
          spawnRing();
        }
        return;
      }

      if (phase === "gameOver" || phase === "title") {
        return;
      }

      nodeAngleP1 = clamp(nodeAngleP1 + p1.x * scaledDt * 2.2, -Math.PI, Math.PI);
      nodeAngleP2 = clamp(nodeAngleP2 + p2.x * scaledDt * 2.2, -Math.PI, Math.PI);

      if (p1.secondary && focusCooldown <= 0 && focusTimer <= 0) {
        focusTimer = 1.4;
        focusCooldown = 8;
        audio.focus();
      }
      if (p2.secondary && focusCooldown <= 0 && focusTimer <= 0) {
        focusTimer = 1.4;
        focusCooldown = 8;
        audio.focus();
      }

      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i];
        ring.radius += ringSpeed * scaledDt;
        evaluateRing(ring, p1.primary, p2.primary, audio);
        if (ring.radius > orbitRadius * 1.8) {
          rings.splice(i, 1);
        }
      }

      for (let i = hitFlashes.length - 1; i >= 0; i -= 1) {
        hitFlashes[i].life -= scaledDt;
        if (hitFlashes[i].life <= 0) {
          hitFlashes.splice(i, 1);
        }
      }
    },

    applyShake(ctx: CanvasRenderingContext2D): void {
      if (shake <= 0) {
        return;
      }
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    },

    render(ctx: CanvasRenderingContext2D, rw: number, rh: number): void {
      ctx.fillStyle = "#0a0612";
      ctx.fillRect(0, 0, rw, rh);

      for (let i = 0; i < 60; i += 1) {
        const sx = ((i * 137.5) % rw);
        const sy = ((i * 97.3) % rh);
        ctx.fillStyle = `rgba(180, 120, 255, ${0.05 + (i % 5) * 0.01})`;
        ctx.fillRect(sx, sy, 2, 2);
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      for (const ring of rings) {
        const t = clamp(ring.radius / orbitRadius, 0, 1.2);
        ctx.strokeStyle = `hsla(${ring.hue}, 80%, 65%, ${0.15 + (1 - t) * 0.35})`;
        ctx.shadowColor = `hsla(${ring.hue}, 100%, 60%, 0.4)`;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2 + (1 - t) * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = `rgba(200, 150, 255, 0.2)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const drawNode = (angle: number, hue: number, label: string): void => {
        const pos = nodePos(angle);
        ctx.fillStyle = `hsl(${hue}, 100%, 60%)`;
        ctx.shadowColor = `hsl(${hue}, 100%, 50%)`;
        ctx.shadowBlur = 18;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.font = "bold 11px Trebuchet MS";
        ctx.textAlign = "center";
        ctx.fillText(label, pos.x, pos.y - 22);
      };

      drawNode(nodeAngleP1, 200, "P1");
      drawNode(nodeAngleP2, 310, "P2");

      for (const flash of hitFlashes) {
        const pos = nodePos(flash.angle);
        const t = flash.life / 0.5;
        ctx.strokeStyle = `hsla(${flash.hue}, 100%, 70%, ${t})`;
        ctx.lineWidth = 4 * t;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 20 + (1 - t) * 30, 0, Math.PI * 2);
        ctx.stroke();
      }

      const coreSize = 18 + pulse * 12;
      ctx.fillStyle = `hsla(280, 100%, 70%, ${0.7 + pulse * 0.3})`;
      ctx.shadowColor = "rgba(200, 100, 255, 0.8)";
      ctx.shadowBlur = 30 + pulse * 20;
      ctx.beginPath();
      ctx.arc(cx, cy, coreSize, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(40, rh - 36, rw - 80, 8);
      ctx.fillStyle = `hsla(280, 100%, 60%, 0.8)`;
      ctx.fillRect(40, rh - 36, ((rw - 80) * bloom) / 100, 8);

      if (focusTimer > 0) {
        ctx.fillStyle = "rgba(180, 120, 255, 0.08)";
        ctx.fillRect(0, 0, rw, rh);
      }

      particles.render(ctx);
    },

    getHud(): { left: string; center: string; right: string } {
      return {
        left: `P1 ${scoreP1}`,
        center:
          phase === "playing"
            ? `Wave ${wave} · Combo ${combo} · ${bpm} BPM`
            : phase === "waveClear"
              ? `Wave ${wave - 1} ascended!`
              : "",
        right: `P2 ${scoreP2}`
      };
    },

    getOverlay(helpHeld: boolean): { title: string; body: string; visible: boolean } {
      if (phase === "title") {
        return {
          title: "ECHO",
          body: HELP_BODY + "\n\nEnter to start  ·  R to restart  ·  Hold H for help",
          visible: true
        };
      }
      if (phase === "gameOver") {
        const winner =
          scoreP1 > scoreP2 ? "P1" : scoreP2 > scoreP1 ? "P2" : "Tie";
        return {
          title: "RESONANCE COMPLETE",
          body:
            `${winner} led with ${Math.max(scoreP1, scoreP2)} pts\n` +
            `P1: ${scoreP1} · P2: ${scoreP2}\n` +
            "Press R to restart.",
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
