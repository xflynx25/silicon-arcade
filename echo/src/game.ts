import type { PlayerInput } from "./input";
import { ParticleSystem } from "./particles";
import { AudioSystem } from "./audio";
import { clamp, vec } from "./vec";

export type GamePhase = "title" | "playing" | "waveClear" | "gameOver";

type HitQuality = "perfect" | "good" | "miss";

type Ring = {
  radius: number;
  p1Arc: number;
  p2Arc: number;
  p1Hit: boolean;
  p2Hit: boolean;
  p1Quality: HitQuality | null;
  p2Quality: HitQuality | null;
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
const ARC_HALF_MAX = 0.4;
const ARC_HALF_MIN = 0.24;

const HELP_BODY =
  "Rhythm co-op — each pulse ring carries two resonance arcs.\n" +
  "Slide to your colored arc on the orbit, then hit as the ring arrives.\n" +
  "Both players must lock their arcs to fill bloom and ascend waves.\n\n" +
  "P1  ·  A/D slide to cyan arc  ·  Left Shift hit  ·  Space slow-mo\n" +
  "P2  ·  ←/→ slide to magenta arc  ·  Right Shift hit  ·  Enter slow-mo";

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

const normalizeAngle = (angle: number): number => {
  let a = angle;
  while (a > Math.PI) {
    a -= Math.PI * 2;
  }
  while (a < -Math.PI) {
    a += Math.PI * 2;
  }
  return a;
};

const angleDelta = (a: number, b: number): number => {
  return Math.abs(normalizeAngle(a - b));
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

  const arcHalfWidth = (): number => {
    if (MAX_WAVES <= 1) {
      return ARC_HALF_MAX;
    }
    const t = (wave - 1) / (MAX_WAVES - 1);
    return ARC_HALF_MAX - t * (ARC_HALF_MAX - ARC_HALF_MIN);
  };

  const recomputeRingSpeed = (): void => {
    const beatDuration = 60 / bpm;
    ringSpeed = orbitRadius / beatDuration;
  };

  const randomArcPair = (): { p1Arc: number; p2Arc: number } => {
    const p1Arc = Math.random() * Math.PI * 2 - Math.PI;
    const offset = Math.PI * (0.55 + Math.random() * 0.9);
    const p2Arc = normalizeAngle(p1Arc + offset);
    return { p1Arc, p2Arc };
  };

  const spawnRing = (): void => {
    const { p1Arc, p2Arc } = randomArcPair();
    rings.push({
      radius: 8,
      p1Arc,
      p2Arc,
      p1Hit: false,
      p2Hit: false,
      p1Quality: null,
      p2Quality: null,
      hue: 270 + wave * 15
    });
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

  const timingQuality = (ringRadius: number): HitQuality | null => {
    const delta = Math.abs(ringRadius - orbitRadius);
    if (delta > GOOD_WINDOW_PX) {
      return null;
    }
    return delta <= PERFECT_WINDOW_PX ? "perfect" : "good";
  };

  const applyMiss = (player: 1 | 2, angle: number, hue: number, audio: AudioSystem): void => {
    combo = 0;
    bloom = Math.max(0, bloom - 10);
    audio.miss();
    shake = 4;
    particles.emit(nodePos(angle), 6, hue, 80);
  };

  const applyHit = (
    player: 1 | 2,
    quality: HitQuality,
    angle: number,
    hue: number,
    audio: AudioSystem
  ): void => {
    if (quality === "miss") {
      applyMiss(player, angle, hue, audio);
      return;
    }

    if (player === 1) {
      scoreP1 += quality === "perfect" ? 2 : 1;
    } else {
      scoreP2 += quality === "perfect" ? 2 : 1;
    }
    combo += 1;
    audio.resonance(quality);
    hitFlashes.push({ angle, life: 0.5, hue });
    particles.emit(nodePos(angle), quality === "perfect" ? 24 : 12, hue, 160);
    shake = quality === "perfect" ? 6 : 3;
  };

  const resolveRingDuo = (ring: Ring, audio: AudioSystem): void => {
    const q1 = ring.p1Quality ?? "miss";
    const q2 = ring.p2Quality ?? "miss";
    if (q1 === "miss" || q2 === "miss") {
      return;
    }

    let duoBloom = 8;
    if (q1 === "perfect" && q2 === "perfect") {
      duoBloom = 18;
      combo += 1;
    } else if (q1 === "perfect" || q2 === "perfect") {
      duoBloom = 12;
    }

    bloom = clamp(bloom + duoBloom, 0, 100);
    pulse = 1;
    audio.resonance("perfect");

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

  const tryPlayerHit = (
    player: 1 | 2,
    ring: Ring,
    pressed: boolean,
    nodeAngle: number,
    arcCenter: number,
    hue: number,
    audio: AudioSystem
  ): void => {
    if (!pressed) {
      return;
    }
    if (player === 1 && ring.p1Hit) {
      return;
    }
    if (player === 2 && ring.p2Hit) {
      return;
    }

    const timing = timingQuality(ring.radius);
    const inArc = angleDelta(nodeAngle, arcCenter) <= arcHalfWidth();

    if (timing === null) {
      return;
    }

    if (!inArc) {
      applyMiss(player, nodeAngle, hue, audio);
      return;
    }

    if (player === 1) {
      ring.p1Hit = true;
      ring.p1Quality = timing;
    } else {
      ring.p2Hit = true;
      ring.p2Quality = timing;
    }
    applyHit(player, timing, nodeAngle, hue, audio);

    if (ring.p1Hit && ring.p2Hit) {
      resolveRingDuo(ring, audio);
    }
  };

  const expireRing = (ring: Ring, audio: AudioSystem): void => {
    if (!ring.p1Hit) {
      applyMiss(1, nodeAngleP1, 200, audio);
      ring.p1Hit = true;
      ring.p1Quality = "miss";
    }
    if (!ring.p2Hit) {
      applyMiss(2, nodeAngleP2, 310, audio);
      ring.p2Hit = true;
      ring.p2Quality = "miss";
    }
  };

  const activeTargetRing = (): Ring | null => {
    let best: Ring | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const ring of rings) {
      if (ring.p1Hit && ring.p2Hit) {
        continue;
      }
      const delta = Math.abs(ring.radius - orbitRadius);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = ring;
      }
    }
    return best;
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

      nodeAngleP1 = normalizeAngle(nodeAngleP1 + p1.x * scaledDt * 2.4);
      nodeAngleP2 = normalizeAngle(nodeAngleP2 + p2.x * scaledDt * 2.4);

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

      for (const ring of rings) {
        ring.radius += ringSpeed * scaledDt;
        tryPlayerHit(1, ring, p1.primary, nodeAngleP1, ring.p1Arc, 200, audio);
        tryPlayerHit(2, ring, p2.primary, nodeAngleP2, ring.p2Arc, 310, audio);
      }

      for (let i = rings.length - 1; i >= 0; i -= 1) {
        const ring = rings[i];
        if (ring.radius > orbitRadius + GOOD_WINDOW_PX * 1.5) {
          expireRing(ring, audio);
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
        const sx = (i * 137.5) % rw;
        const sy = (i * 97.3) % rh;
        ctx.fillStyle = `rgba(180, 120, 255, ${0.05 + (i % 5) * 0.01})`;
        ctx.fillRect(sx, sy, 2, 2);
      }

      ctx.save();
      ctx.globalCompositeOperation = "lighter";

      const half = arcHalfWidth();
      const targetRing = activeTargetRing();

      const drawArcMarker = (
        angle: number,
        hue: number,
        radius: number,
        alpha: number,
        width: number
      ): void => {
        ctx.strokeStyle = `hsla(${hue}, 100%, 65%, ${alpha})`;
        ctx.shadowColor = `hsla(${hue}, 100%, 55%, ${alpha * 0.8})`;
        ctx.shadowBlur = 14;
        ctx.lineWidth = width;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, angle - half, angle + half);
        ctx.stroke();
      };

      if (targetRing) {
        drawArcMarker(targetRing.p1Arc, 200, orbitRadius, 0.85, 6);
        drawArcMarker(targetRing.p2Arc, 310, orbitRadius, 0.85, 6);
      }

      for (const ring of rings) {
        const t = clamp(ring.radius / orbitRadius, 0, 1.2);
        ctx.strokeStyle = `hsla(${ring.hue}, 80%, 65%, ${0.15 + (1 - t) * 0.35})`;
        ctx.shadowColor = `hsla(${ring.hue}, 100%, 60%, 0.4)`;
        ctx.shadowBlur = 12;
        ctx.lineWidth = 2 + (1 - t) * 3;
        ctx.beginPath();
        ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
        ctx.stroke();

        if (Math.abs(ring.radius - orbitRadius) < GOOD_WINDOW_PX * 2) {
          drawArcMarker(ring.p1Arc, 200, ring.radius, 0.55, 4);
          drawArcMarker(ring.p2Arc, 310, ring.radius, 0.55, 4);
        }
      }

      ctx.strokeStyle = "rgba(200, 150, 255, 0.2)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, orbitRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const drawGuide = (nodeAngle: number, arcAngle: number, hue: number): void => {
        if (angleDelta(nodeAngle, arcAngle) <= half) {
          return;
        }
        const from = nodePos(nodeAngle);
        const to = nodePos(arcAngle);
        ctx.strokeStyle = `hsla(${hue}, 90%, 60%, 0.25)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 6]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (targetRing) {
        drawGuide(nodeAngleP1, targetRing.p1Arc, 200);
        drawGuide(nodeAngleP2, targetRing.p2Arc, 310);
      }

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
        const flashT = flash.life / 0.5;
        ctx.strokeStyle = `hsla(${flash.hue}, 100%, 70%, ${flashT})`;
        ctx.lineWidth = 4 * flashT;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, 20 + (1 - flashT) * 30, 0, Math.PI * 2);
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
      ctx.fillStyle = "hsla(280, 100%, 60%, 0.8)";
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
