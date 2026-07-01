export type Vec = {
  x: number;
  y: number;
};

export const vec = (x = 0, y = 0): Vec => ({ x, y });

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (v: Vec, s: number): Vec => ({ x: v.x * s, y: v.y * s });

export const len = (v: Vec): number => Math.hypot(v.x, v.y);

export const dist = (a: Vec, b: Vec): number => len(sub(a, b));

export const normalize = (v: Vec): Vec => {
  const l = len(v);
  if (l <= 0.00001) {
    return vec(0, 0);
  }
  return scale(v, 1 / l);
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const clampLen = (v: Vec, max: number): Vec => {
  const l = len(v);
  if (l <= max) {
    return v;
  }
  return scale(v, max / Math.max(l, 0.00001));
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
