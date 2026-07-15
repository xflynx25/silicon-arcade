export type PlayStyle = "variety" | "fixed";

export type VarietyLocks = {
  map: boolean;
  ricochet: boolean;
  powerups: boolean;
  concurrent: boolean;
  fireCd: boolean;
  roundAmmo: boolean;
};

export type MatchConfig = {
  mapIdx: number;
  ruleIdx: number;
  powerupsOn: boolean;
  concurrentIdx: number;
  fireCdIdx: number;
  roundAmmoIdx: number;
};

export const CONCURRENT_STEPS = [1, 2, 3, 5, Infinity] as const;
export const CONCURRENT_LABELS = ["1", "2", "3", "5", "Unlimited"] as const;

export const FIRE_CD_STEPS = [0.7, 0.45, 0.28, 0.15] as const;
export const FIRE_CD_LABELS = ["Slow", "Normal", "Fast", "Spray"] as const;

export const ROUND_AMMO_STEPS = [Infinity, 8, 15, 30] as const;
export const ROUND_AMMO_LABELS = ["Unlimited", "8", "15", "30"] as const;

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  mapIdx: 0,
  ruleIdx: 0,
  powerupsOn: true,
  concurrentIdx: 1,
  fireCdIdx: 1,
  roundAmmoIdx: 0
};

export const DEFAULT_VARIETY_LOCKS: VarietyLocks = {
  map: false,
  ricochet: false,
  powerups: false,
  concurrent: false,
  fireCd: false,
  roundAmmo: false
};

const randIdx = (len: number): number => (Math.random() * len) | 0;

export const rollUnlockedSettings = (
  base: MatchConfig,
  locks: VarietyLocks,
  mapCount: number,
  ruleCount: number
): MatchConfig => ({
  mapIdx: locks.map ? base.mapIdx : randIdx(mapCount),
  ruleIdx: locks.ricochet ? base.ruleIdx : randIdx(ruleCount),
  powerupsOn: locks.powerups ? base.powerupsOn : Math.random() < 0.5,
  concurrentIdx: locks.concurrent ? base.concurrentIdx : randIdx(CONCURRENT_STEPS.length),
  fireCdIdx: locks.fireCd ? base.fireCdIdx : randIdx(FIRE_CD_STEPS.length),
  roundAmmoIdx: locks.roundAmmo ? base.roundAmmoIdx : randIdx(ROUND_AMMO_STEPS.length)
});

export const concurrentShells = (idx: number): number => CONCURRENT_STEPS[idx];
export const fireCooldown = (idx: number): number => FIRE_CD_STEPS[idx];
export const roundAmmoPool = (idx: number): number => ROUND_AMMO_STEPS[idx];

export const playStyleLabel = (style: PlayStyle): string =>
  style === "variety" ? "Variety" : "Fixed";

export const lockGlyph = (locked: boolean): string => (locked ? "🔒" : "🔓");
